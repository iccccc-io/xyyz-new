/**
 * 云函数：cancel_order
 * 买家取消待付款订单（status=10 → 50），并原子回滚库存
 *
 * 管理员权限执行，确保库存回滚一定成功
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

/**
 * @param {string} event.order_id     - 要取消的订单 ID
 * @param {string} [event.reason]     - 取消原因（可选）
 * @returns {{ success: boolean, message: string }}
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { order_id, reason = '买家主动取消' } = event

  if (!order_id) {
    return { success: false, message: '参数错误：缺少订单ID' }
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

    // ========== 2. 验证身份 ==========
    if (order._openid !== openid) {
      console.warn(`[cancel_order] 安全警告: ${openid} 尝试取消他人订单 ${order_id}`)
      return { success: false, message: '无权操作此订单' }
    }

    // ========== 3. 验证状态 ==========
    if (order.status !== 10) {
      const statusMap = { 20: '已支付', 30: '已发货', 40: '已完成', 50: '已取消' }
      return { success: false, message: `订单${statusMap[order.status] || '状态异常'}，无法取消` }
    }

    // ========== 4. 取消订单 + 回滚库存 ==========
    const productId = order.product_snapshot && order.product_snapshot.product_id
    const quantity = order.quantity || 1

    // 4a. 更新订单状态
    await db.collection('shopping_orders').doc(order_id).update({
      data: {
        status: 50,
        cancel_reason: reason,
        update_time: db.serverDate()
      }
    })

    // 4b. 回滚库存（商品可能已被删除，try-catch 容错）
    if (productId && quantity > 0) {
      try {
        await db.collection('shopping_products').doc(productId).update({
          data: {
            stock: _.inc(quantity),
            update_time: db.serverDate()
          }
        })
      } catch (e) {
        console.warn(`[cancel_order] 库存回滚失败(商品可能已删除): ${productId}`, e.message)
      }
    }

    console.log(`[cancel_order] 成功: 用户=${openid}, 订单=${order_id}`)

    return { success: true, message: '订单已取消' }

  } catch (err) {
    console.error('[cancel_order] 异常:', err)
    return { success: false, message: err.message || '取消失败' }
  }
}
