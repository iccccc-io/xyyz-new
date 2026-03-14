// 云函数入口文件 - 模拟支付处理
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

/**
 * 模拟支付云函数
 * 核心链路：验密码 → 查余额 → 事务扣款+改订单状态 → 记账本流水
 *
 * @param {Object} event
 * @param {string} event.order_id    - 待支付的订单 ID（status 必须为 10）
 * @param {string} event.pay_password - 用户输入的 6 位支付密码
 *
 * @returns {{ success: boolean, message: string, pay_id?: string }}
 */
exports.main = async (event, context) => {
  const { order_id, pay_password } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // ========== 参数校验 ==========
  if (!order_id || !pay_password) {
    return { success: false, message: '参数错误：缺少订单ID或支付密码' }
  }
  if (pay_password.length !== 6 || !/^\d{6}$/.test(pay_password)) {
    return { success: false, message: '支付密码必须是 6 位数字' }
  }

  try {
    // ========== 1. 查询订单 ==========
    let orderRes
    try {
      orderRes = await db.collection('shopping_orders').doc(order_id).get()
    } catch (e) {
      return { success: false, message: '订单不存在' }
    }

    const order = orderRes.data

    if (order._openid !== openid) {
      console.warn(`[安全警告] ${openid} 尝试支付他人订单 ${order_id}`)
      return { success: false, message: '无权操作此订单' }
    }
    if (order.status !== 10) {
      const statusMap = { 20: '已支付', 40: '已完成', 50: '已取消', 60: '售后中' }
      return { success: false, message: `订单${statusMap[order.status] || '状态异常'}，无法支付` }
    }

    // ========== 2. 查询钱包 ==========
    const walletRes = await db.collection('shopping_wallets')
      .where({ _openid: openid })
      .get()

    if (!walletRes.data || walletRes.data.length === 0) {
      return { success: false, message: '钱包不存在，请重新登录初始化' }
    }

    const wallet = walletRes.data[0]

    if (wallet.status === 2) {
      return { success: false, message: '账户已被锁定，请联系客服' }
    }

    // ========== 3. 验证支付密码 ==========
    if (!wallet.pay_password) {
      return { success: false, message: '请先设置支付密码' }
    }
    if (wallet.pay_password !== pay_password) {
      return { success: false, message: '支付密码错误，请重试' }
    }

    // ========== 4. 检查余额（单位：分） ==========
    if (wallet.balance < order.total_price) {
      const shortfall = order.total_price - wallet.balance
      return {
        success: false,
        message: `余额不足，还差 ¥${(shortfall / 100).toFixed(2)}，请先充值`
      }
    }

    // ========== 5. 事务：原子扣款 + 更新订单状态 10→20 ==========
    const transaction = await db.startTransaction()
    try {
      // 5a. 扣减买家余额（用 doc(id) 精确定位，避免 where 在事务中的限制）
      await transaction.collection('shopping_wallets').doc(wallet._id).update({
        data: {
          balance: _.inc(-order.total_price),
          update_time: db.serverDate()
        }
      })

      // 5b. 订单状态 Pending_Pay(10) → Pending_Ship(20)
      await transaction.collection('shopping_orders').doc(order_id).update({
        data: {
          status: 20,
          pay_time: db.serverDate(),
          update_time: db.serverDate()
        }
      })

      await transaction.commit()
      console.log(`[支付] 事务成功：用户 ${openid}，订单 ${order_id}，金额 ${order.total_price} 分`)
    } catch (txErr) {
      await transaction.rollback()
      console.error('[支付] 事务回滚：', txErr)
      return { success: false, message: '支付处理失败，请稍后重试' }
    }

    // ========== 6. 账本流水（事务外，非阻塞性记录） ==========
    const payId = `PAY_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const productTitle = (order.product_snapshot && order.product_snapshot.title) || '未知商品'

    await Promise.all([
      // 买家支出流水
      db.collection('shopping_ledger').add({
        data: {
          order_id,
          user_id: openid,
          type: 'PAYMENT',
          amount: -order.total_price,
          description: `支付订单：${productTitle}`,
          create_time: db.serverDate()
        }
      }),
      // 支付记录
      db.collection('shopping_pay_records').add({
        data: {
          pay_id: payId,
          order_id,
          fee: order.total_price,
          status: 1,           // 1: 支付成功
          pay_time: db.serverDate()
        }
      })
    ]).catch(logErr => {
      // 流水记录失败不影响主流程，仅打印
      console.warn('[支付] 账本记录失败（不影响订单）：', logErr)
    })

    return {
      success: true,
      message: '支付成功',
      pay_id: payId
    }

  } catch (err) {
    console.error('[process_payment 异常]', err)
    return { success: false, message: `支付失败：${err.message || '未知错误'}` }
  }
}
