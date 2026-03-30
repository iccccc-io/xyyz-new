const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const BATCH = 50
const INTERNAL_AUTO_REVIEW_TOKEN = 'xyyz_review_auto_v1'
const INTERNAL_AUTO_CONFIRM_TOKEN = 'xyyz_confirm_auto_v1'

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function findSkuIndex(product, skuId) {
  const skus = Array.isArray(product && product.skus) ? product.skus : []
  return skus.findIndex((item) => getSafeString(item && item.sku_id) === getSafeString(skuId))
}

exports.main = async () => {
  const start = Date.now()
  const stats = {
    cancelledUnpaid: 0,
    autoConfirmed: 0,
    autoReviewed: 0,
    autoSettled: 0,
    autoApprovedAS: 0,
    autoClosedAS: 0,
    autoRefundedAS: 0,
    errors: []
  }

  try {
    await Promise.all([
      task1CancelUnpaid(stats),
      task2AutoConfirmReceipt(stats),
      task25AutoReview(stats),
      task3AutoSettle(stats),
      task4AutoApproveAftersale(stats),
      task5AutoCloseAftersale(stats),
      task6AutoRefundAftersale(stats)
    ])
  } catch (err) {
    console.error('[auto_cancel_orders] top level error:', err)
    stats.errors.push({ task: 'top', error: err.message })
  }

  return {
    success: true,
    elapsed_ms: Date.now() - start,
    ...stats
  }
}

async function task1CancelUnpaid(stats) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000)

  try {
    const res = await db.collection('shopping_orders')
      .where({ status: 10, create_time: _.lt(cutoff) })
      .field({
        _id: true,
        quantity: true,
        'product_snapshot.product_id': true,
        'product_snapshot.sku_id': true
      })
      .limit(BATCH)
      .get()

    for (const order of (res.data || [])) {
      let transaction = null
      try {
        const productId = order.product_snapshot && order.product_snapshot.product_id
        const skuId = order.product_snapshot && order.product_snapshot.sku_id
        const quantity = Number(order.quantity) || 0

        transaction = await db.startTransaction()

        await transaction.collection('shopping_orders').doc(order._id).update({
          data: {
            status: 50,
            cancel_reason: '超时未支付，系统自动取消',
            update_time: db.serverDate()
          }
        })

        if (productId && quantity > 0) {
          const productRes = await transaction.collection('shopping_products').doc(productId).get()
          const product = productRes.data
          const skuIndex = findSkuIndex(product, skuId)

          if (skuIndex < 0) {
            throw new Error('订单对应的商品款式不存在，无法自动回滚库存')
          }

          await transaction.collection('shopping_products').doc(productId).update({
            data: {
              total_stock: _.inc(quantity),
              [`skus.${skuIndex}.stock`]: _.inc(quantity),
              update_time: db.serverDate()
            }
          })
        }

        await transaction.commit()
        stats.cancelledUnpaid += 1
      } catch (err) {
        if (transaction) {
          await transaction.rollback().catch(() => {})
        }
        stats.errors.push({
          task: 'cancelUnpaid',
          orderId: order._id,
          error: err.message
        })
      }
    }
  } catch (err) {
    stats.errors.push({ task: 'cancelUnpaid_query', error: err.message })
  }
}

async function task2AutoConfirmReceipt(stats) {
  const cutoff = new Date(Date.now() - 10 * 24 * 3600 * 1000)

  try {
    const res = await db.collection('shopping_orders')
      .where({ status: 30, ship_time: _.lt(cutoff) })
      .field({ _id: true })
      .limit(BATCH)
      .get()

    for (const order of (res.data || [])) {
      try {
        const cfRes = await cloud.callFunction({
          name: 'confirm_receipt',
          data: {
            order_id: order._id,
            _internal_token: INTERNAL_AUTO_CONFIRM_TOKEN
          }
        })

        if (cfRes.result && cfRes.result.success) {
          stats.autoConfirmed += 1
        } else {
          stats.errors.push({
            task: 'autoConfirm',
            orderId: order._id,
            error: (cfRes.result && cfRes.result.message) || 'unknown'
          })
        }
      } catch (err) {
        stats.errors.push({ task: 'autoConfirm', orderId: order._id, error: err.message })
      }
    }
  } catch (err) {
    stats.errors.push({ task: 'autoConfirm_query', error: err.message })
  }
}

async function task25AutoReview(stats) {
  const cutoff = new Date(Date.now() - 15 * 24 * 3600 * 1000)

  try {
    const res = await db.collection('shopping_orders')
      .where({
        status: 40,
        has_aftersale: _.neq(true),
        complete_time: _.lte(cutoff)
      })
      .field({
        _id: true,
        review_status: true,
        review_id: true
      })
      .limit(BATCH)
      .get()

    for (const order of (res.data || [])) {
      if (Number(order.review_status) === 1 || order.review_id) {
        continue
      }
      try {
        const cfRes = await cloud.callFunction({
          name: 'manage_review',
          data: {
            action: 'submit_auto',
            order_id: order._id,
            _internal_token: INTERNAL_AUTO_REVIEW_TOKEN
          }
        })

        if (cfRes.result && cfRes.result.success) {
          stats.autoReviewed += 1
        } else {
          stats.errors.push({
            task: 'autoReview',
            orderId: order._id,
            error: (cfRes.result && cfRes.result.message) || 'unknown'
          })
        }
      } catch (err) {
        stats.errors.push({
          task: 'autoReview',
          orderId: order._id,
          error: err.message
        })
      }
    }
  } catch (err) {
    stats.errors.push({ task: 'autoReview_query', error: err.message })
  }
}

async function task3AutoSettle(stats) {
  try {
    const cfRes = await cloud.callFunction({
      name: 'auto_settlement',
      data: {}
    })

    if (cfRes.result && cfRes.result.success) {
      stats.autoSettled += Number(cfRes.result.settled_count) || 0
      ;(cfRes.result.errors || []).forEach((item) => {
        stats.errors.push({
          task: 'autoSettle',
          ...(item || {})
        })
      })
    } else {
      stats.errors.push({
        task: 'autoSettle',
        error: (cfRes.result && cfRes.result.message) || 'unknown'
      })
    }
  } catch (err) {
    stats.errors.push({ task: 'autoSettle', error: err.message })
  }
}

async function task4AutoApproveAftersale(stats) {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000)

  try {
    const res = await db.collection('shopping_aftersales')
      .where({ status: 0, apply_time: _.lt(cutoff) })
      .limit(BATCH)
      .get()

    for (const aftersale of (res.data || [])) {
      try {
        if (aftersale.type === 'refund_only') {
          await cloud.callFunction({
            name: 'manage_aftersale',
            data: { action: 'system_refund', aftersale_id: aftersale._id }
          })
        } else {
          await db.collection('shopping_aftersales').doc(aftersale._id).update({
            data: {
              status: 1,
              return_address: {
                name: '（系统自动通过）',
                phone: '请联系卖家获取地址',
                detail: '卖家48小时未处理，系统自动同意退货'
              },
              approve_time: db.serverDate(),
              operation_logs: _.push({
                operator: 'system',
                action: 'auto_approve',
                time: new Date().toISOString(),
                content: '卖家48小时未处理退货退款申请，系统自动同意退货'
              }),
              update_time: db.serverDate()
            }
          })
        }

        stats.autoApprovedAS += 1
      } catch (err) {
        stats.errors.push({ task: 'autoApproveAS', asId: aftersale._id, error: err.message })
      }
    }
  } catch (err) {
    stats.errors.push({ task: 'autoApproveAS_query', error: err.message })
  }
}

async function task5AutoCloseAftersale(stats) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000)

  try {
    const res = await db.collection('shopping_aftersales')
      .where({ status: 1, approve_time: _.lt(cutoff) })
      .limit(BATCH)
      .get()

    for (const aftersale of (res.data || [])) {
      try {
        await db.collection('shopping_aftersales').doc(aftersale._id).update({
          data: {
            status: -2,
            close_time: db.serverDate(),
            operation_logs: _.push({
              operator: 'system',
              action: 'auto_close',
              time: new Date().toISOString(),
              content: '买家7天未寄回退货，系统自动关闭售后'
            }),
            update_time: db.serverDate()
          }
        })

        await db.collection('shopping_orders').doc(aftersale.order_id).update({
          data: {
            has_aftersale: false,
            update_time: db.serverDate()
          }
        })

        stats.autoClosedAS += 1
      } catch (err) {
        stats.errors.push({ task: 'autoCloseAS', asId: aftersale._id, error: err.message })
      }
    }
  } catch (err) {
    stats.errors.push({ task: 'autoCloseAS_query', error: err.message })
  }
}

async function task6AutoRefundAftersale(stats) {
  const cutoff = new Date(Date.now() - 10 * 24 * 3600 * 1000)

  try {
    const res = await db.collection('shopping_aftersales')
      .where({ status: 2, ship_time: _.lt(cutoff) })
      .limit(BATCH)
      .get()

    for (const aftersale of (res.data || [])) {
      try {
        const cfRes = await cloud.callFunction({
          name: 'manage_aftersale',
          data: { action: 'confirm_return', aftersale_id: aftersale._id, _system: true }
        })

        if (cfRes.result && cfRes.result.success) {
          stats.autoRefundedAS += 1
        } else {
          stats.errors.push({
            task: 'autoRefundAS',
            asId: aftersale._id,
            error: (cfRes.result && cfRes.result.message) || 'unknown'
          })
        }
      } catch (err) {
        stats.errors.push({ task: 'autoRefundAS', asId: aftersale._id, error: err.message })
      }
    }
  } catch (err) {
    stats.errors.push({ task: 'autoRefundAS_query', error: err.message })
  }
}
