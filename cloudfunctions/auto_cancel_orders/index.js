/**
 * 云函数：auto_cancel_orders（订单守护进程）
 * 触发方式：定时触发器（见 config.json）
 *
 * 五合一守护逻辑：
 *  1. 超时未付款订单自动取消      (status=10, >30分钟)
 *  2. 超时未收货订单自动确认       (status=30, >10天)
 *  3. 售后窗口期到期自动结算       (status=40, settled=false, settle_deadline<now, has_aftersale≠true)
 *  4. 卖家审核售后超时自动通过     (aftersale status=0, >48小时)
 *  5. 买家退货寄回超时自动关闭     (aftersale status=1, >7天)
 *  6. 卖家验收退货超时自动退款     (aftersale status=2, >10天)
 *
 * 幂等性：通过状态+时间判断保证重复触发安全
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const BATCH = 50

exports.main = async (event, context) => {
  const start = Date.now()
  const stats = {
    cancelledUnpaid: 0,
    autoConfirmed: 0,
    autoSettled: 0,
    autoApprovedAS: 0,
    autoClosedAS: 0,
    autoRefundedAS: 0,
    errors: []
  }

  try {
    await Promise.all([
      task1_cancelUnpaid(stats),
      task2_autoConfirmReceipt(stats),
      task3_autoSettle(stats),
      task4_autoApproveAftersale(stats),
      task5_autoCloseAftersale(stats),
      task6_autoRefundAftersale(stats)
    ])
  } catch (err) {
    console.error('[守护进程] 顶层异常:', err)
    stats.errors.push({ task: 'top', error: err.message })
  }

  const elapsed = Date.now() - start
  console.log(`[守护进程] 完成 耗时${elapsed}ms`, JSON.stringify(stats))
  return { success: true, elapsed_ms: elapsed, ...stats }
}

// ====================================================================
// 1. 超时未付款自动取消 (status=10, >30分钟)
// ====================================================================
async function task1_cancelUnpaid(stats) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000)
  try {
    const res = await db.collection('shopping_orders')
      .where({ status: 10, create_time: _.lt(cutoff) })
      .field({ _id: true, quantity: true, 'product_snapshot.product_id': true })
      .limit(BATCH).get()

    for (const order of (res.data || [])) {
      try {
        const productId = order.product_snapshot && order.product_snapshot.product_id
        const tasks = [
          db.collection('shopping_orders').doc(order._id).update({
            data: { status: 50, cancel_reason: '超时未支付，系统自动取消', update_time: db.serverDate() }
          })
        ]
        if (productId && order.quantity > 0) {
          tasks.push(db.collection('shopping_products').doc(productId).update({
            data: { stock: _.inc(order.quantity) }
          }))
        }
        await Promise.all(tasks)
        stats.cancelledUnpaid++
      } catch (e) {
        stats.errors.push({ task: 'cancelUnpaid', orderId: order._id, error: e.message })
      }
    }
  } catch (e) {
    stats.errors.push({ task: 'cancelUnpaid_query', error: e.message })
  }
}

// ====================================================================
// 2. 超时未确认收货自动完成 (status=30, >10天)
// ====================================================================
async function task2_autoConfirmReceipt(stats) {
  const cutoff = new Date(Date.now() - 10 * 24 * 3600 * 1000)
  try {
    const res = await db.collection('shopping_orders')
      .where({ status: 30, ship_time: _.lt(cutoff) })
      .field({ _id: true, total_price: true, seller_openid: true, 'product_snapshot.title': true })
      .limit(BATCH).get()

    for (const order of (res.data || [])) {
      try {
        const settleDeadline = new Date(Date.now() + 7 * 24 * 3600 * 1000)
        // 更新订单
        await db.collection('shopping_orders').doc(order._id).update({
          data: {
            status: 40, complete_time: db.serverDate(),
            settle_deadline: settleDeadline, settled: false,
            update_time: db.serverDate()
          }
        })
        // 卖家 settling_balance +
        if (order.seller_openid && order.total_price > 0) {
          await db.collection('shopping_wallets')
            .where({ _openid: order.seller_openid })
            .update({
              data: { settling_balance: _.inc(order.total_price), update_time: db.serverDate() }
            })
        }
        stats.autoConfirmed++
      } catch (e) {
        stats.errors.push({ task: 'autoConfirm', orderId: order._id, error: e.message })
      }
    }
  } catch (e) {
    stats.errors.push({ task: 'autoConfirm_query', error: e.message })
  }
}

// ====================================================================
// 3. 售后窗口到期 → 自动结算（settling_balance → balance）
// ====================================================================
async function task3_autoSettle(stats) {
  const now = new Date()
  try {
    const res = await db.collection('shopping_orders')
      .where({
        status: 40,
        settled: false,
        has_aftersale: _.neq(true),
        settle_deadline: _.lt(now)
      })
      .field({ _id: true, total_price: true, seller_openid: true, 'product_snapshot.title': true })
      .limit(BATCH).get()

    for (const order of (res.data || [])) {
      try {
        const sellerOpenid = order.seller_openid
        const amount = order.total_price
        if (!sellerOpenid || !amount) continue

        // 事务：settling_balance → balance
        const transaction = await db.startTransaction()
        try {
          const walletRes = await db.collection('shopping_wallets')
            .where({ _openid: sellerOpenid }).limit(1).get()
          if (walletRes.data && walletRes.data.length > 0) {
            const wid = walletRes.data[0]._id
            await transaction.collection('shopping_wallets').doc(wid).update({
              data: {
                settling_balance: _.inc(-amount),
                balance: _.inc(amount),
                update_time: db.serverDate()
              }
            })
          }
          await transaction.collection('shopping_orders').doc(order._id).update({
            data: { settled: true, update_time: db.serverDate() }
          })
          await transaction.commit()

          // 账本
          await db.collection('shopping_ledger').add({
            data: {
              order_id: order._id, user_id: sellerOpenid, type: 'SETTLEMENT',
              amount,
              description: `售后窗口到期自动结算：${(order.product_snapshot && order.product_snapshot.title) || ''}`,
              create_time: db.serverDate()
            }
          }).catch(() => {})

          stats.autoSettled++
        } catch (txErr) {
          await transaction.rollback()
          throw txErr
        }
      } catch (e) {
        stats.errors.push({ task: 'autoSettle', orderId: order._id, error: e.message })
      }
    }
  } catch (e) {
    stats.errors.push({ task: 'autoSettle_query', error: e.message })
  }
}

// ====================================================================
// 4. 卖家48小时未审核 → 自动同意售后
// ====================================================================
async function task4_autoApproveAftersale(stats) {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000)
  try {
    const res = await db.collection('shopping_aftersales')
      .where({ status: 0, apply_time: _.lt(cutoff) })
      .limit(BATCH).get()

    for (const as of (res.data || [])) {
      try {
        if (as.type === 'refund_only') {
          // 仅退款 → 直接执行退款（系统级调用）
          await cloud.callFunction({
            name: 'manage_aftersale',
            data: { action: 'system_refund', aftersale_id: as._id }
          })
        } else {
          await db.collection('shopping_aftersales').doc(as._id).update({
            data: {
              status: 1,
              return_address: { name: '（系统自动通过）', phone: '请联系卖家获取地址', detail: '卖家48小时未处理，系统自动同意退货' },
              approve_time: db.serverDate(),
              operation_logs: _.push({
                operator: 'system', action: 'auto_approve',
                time: new Date().toISOString(),
                content: '卖家48小时未处理退货退款申请，系统自动同意退货'
              }),
              update_time: db.serverDate()
            }
          })
        }
        stats.autoApprovedAS++
      } catch (e) {
        stats.errors.push({ task: 'autoApproveAS', asId: as._id, error: e.message })
      }
    }
  } catch (e) {
    stats.errors.push({ task: 'autoApproveAS_query', error: e.message })
  }
}

// ====================================================================
// 5. 买家7天未寄回 → 自动关闭售后
// ====================================================================
async function task5_autoCloseAftersale(stats) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  try {
    const res = await db.collection('shopping_aftersales')
      .where({ status: 1, approve_time: _.lt(cutoff) })
      .limit(BATCH).get()

    for (const as of (res.data || [])) {
      try {
        await db.collection('shopping_aftersales').doc(as._id).update({
          data: {
            status: -2,
            close_time: db.serverDate(),
            operation_logs: _.push({
              operator: 'system', action: 'auto_close',
              time: new Date().toISOString(),
              content: '买家7天未寄回退货，系统自动关闭售后'
            }),
            update_time: db.serverDate()
          }
        })
        await db.collection('shopping_orders').doc(as.order_id).update({
          data: { has_aftersale: false, update_time: db.serverDate() }
        })
        stats.autoClosedAS++
      } catch (e) {
        stats.errors.push({ task: 'autoCloseAS', asId: as._id, error: e.message })
      }
    }
  } catch (e) {
    stats.errors.push({ task: 'autoCloseAS_query', error: e.message })
  }
}

// ====================================================================
// 6. 卖家10天未验收退货 → 自动退款
// ====================================================================
async function task6_autoRefundAftersale(stats) {
  const cutoff = new Date(Date.now() - 10 * 24 * 3600 * 1000)
  try {
    const res = await db.collection('shopping_aftersales')
      .where({ status: 2, ship_time: _.lt(cutoff) })
      .limit(BATCH).get()

    for (const as of (res.data || [])) {
      try {
        // 调用退款逻辑（系统级调用，跳过权限校验）
        const cfRes = await cloud.callFunction({
          name: 'manage_aftersale',
          data: { action: 'confirm_return', aftersale_id: as._id, _system: true }
        })
        if (cfRes.result && cfRes.result.success) {
          stats.autoRefundedAS++
        } else {
          stats.errors.push({ task: 'autoRefundAS', asId: as._id, error: cfRes.result && cfRes.result.message })
        }
      } catch (e) {
        stats.errors.push({ task: 'autoRefundAS', asId: as._id, error: e.message })
      }
    }
  } catch (e) {
    stats.errors.push({ task: 'autoRefundAS_query', error: e.message })
  }
}
