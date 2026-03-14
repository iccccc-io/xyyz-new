/**
 * 云函数：confirm_receipt - 买家确认收货
 * 
 * 延期结算 (Escrow Buffer) 逻辑：
 *  - 确认收货后，资金进入卖家 settling_balance（结算中余额），而非 balance
 *  - 设置 settle_deadline = 当前时间 + 7 天
 *  - 7天售后窗口内无售后申请，守护进程自动将资金转入卖家 balance
 *  - 若发起售后，资金锁定在 settling_balance 直到售后结束
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const SETTLE_BUFFER_DAYS = 7

exports.main = async (event, context) => {
  const { order_id } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!order_id) {
    return { success: false, message: '参数错误：缺少订单ID' }
  }

  try {
    // ===== 1. 查询订单 =====
    let orderRes
    try {
      orderRes = await db.collection('shopping_orders').doc(order_id).get()
    } catch (e) {
      return { success: false, message: '订单不存在' }
    }

    const order = orderRes.data

    if (order._openid !== openid) {
      console.warn(`[安全警告] ${openid} 尝试确认他人订单 ${order_id}`)
      return { success: false, message: '无权操作此订单' }
    }

    if (order.status !== 30) {
      const statusMap = { 10: '待付款', 20: '待发货', 40: '已完成', 50: '已取消' }
      return { success: false, message: `订单${statusMap[order.status] || '状态异常'}，无法确认收货` }
    }

    // ===== 2. 查询/初始化卖家钱包 =====
    const sellerOpenid = order.seller_openid ||
      (order.product_snapshot && order.product_snapshot.seller_openid)

    if (!sellerOpenid) {
      return { success: false, message: '订单数据异常：缺少卖家信息' }
    }

    let sellerWalletRes = await db.collection('shopping_wallets')
      .where({ _openid: sellerOpenid })
      .get()

    if (!sellerWalletRes.data || sellerWalletRes.data.length === 0) {
      await db.collection('shopping_wallets').add({
        data: {
          _openid: sellerOpenid,
          balance: 0,
          frozen_balance: 0,
          settling_balance: 0,
          pay_password: '',
          status: 1,
          create_time: db.serverDate(),
          update_time: db.serverDate()
        }
      })
      sellerWalletRes = await db.collection('shopping_wallets')
        .where({ _openid: sellerOpenid })
        .get()
      if (!sellerWalletRes.data || sellerWalletRes.data.length === 0) {
        return { success: false, message: '卖家钱包初始化失败' }
      }
    }

    const sellerWallet = sellerWalletRes.data[0]
    const settlementAmount = order.total_price

    // 计算结算截止时间：7天后
    const settleDeadline = new Date(Date.now() + SETTLE_BUFFER_DAYS * 24 * 3600 * 1000)

    // ===== 3. 事务：订单 30→40 + 卖家 settling_balance 增加 =====
    const transaction = await db.startTransaction()
    try {
      await transaction.collection('shopping_orders').doc(order_id).update({
        data: {
          status: 40,
          complete_time: db.serverDate(),
          settle_deadline: settleDeadline,
          settled: false,
          update_time: db.serverDate()
        }
      })

      await transaction.collection('shopping_wallets').doc(sellerWallet._id).update({
        data: {
          settling_balance: _.inc(settlementAmount),
          update_time: db.serverDate()
        }
      })

      await transaction.commit()
      console.log(`[结算] 确认收货：买家 ${openid}，订单 ${order_id}，卖家 ${sellerOpenid} 冻结 ${settlementAmount} 分，7天后自动结算`)
    } catch (txErr) {
      await transaction.rollback()
      console.error('[confirm_receipt] 事务回滚:', txErr)
      return { success: false, message: '确认失败，请稍后重试' }
    }

    // ===== 4. 账本流水（事务外，非阻塞） =====
    const productTitle = (order.product_snapshot && order.product_snapshot.title) || '未知商品'

    await Promise.all([
      db.collection('shopping_ledger').add({
        data: {
          order_id,
          user_id: sellerOpenid,
          type: 'SETTLEMENT_FROZEN',
          amount: settlementAmount,
          description: `确认收货，资金冻结（7天后自动结算）：${productTitle}`,
          create_time: db.serverDate()
        }
      }),
      cloud.callFunction({
        name: 'send_notification',
        data: {
          type: 'TYPE_SETTLED',
          touser: sellerOpenid,
          page: '/pages/wallet/index',
          payload: { productTitle, amount: settlementAmount }
        }
      }).catch(e => console.warn('[confirm_receipt] 发送卖家通知失败:', e))
    ]).catch(logErr => {
      console.warn('[confirm_receipt] 账本/通知失败（不影响订单）:', logErr)
    })

    return { success: true, message: '确认收货成功，货款将在7天售后期后结算给卖家' }

  } catch (err) {
    console.error('[confirm_receipt 异常]', err)
    return { success: false, message: `操作失败：${err.message || '未知错误'}` }
  }
}
