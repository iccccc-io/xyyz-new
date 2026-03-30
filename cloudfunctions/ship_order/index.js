// 云函数：ship_order - 卖家发货，状态 20(待发货) → 30(已发货)
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/**
 * @param {string} event.order_id       - 订单 ID
 * @param {string} event.carrier_code   - 快递公司代码（如 "SF", "YTO", "ZTO"）
 * @param {string} event.tracking_number - 快递单号
 * @param {boolean} event.pickup_confirmed - 同城自提时确认已交付商品
 * @returns {{ success: boolean, message: string }}
 */
exports.main = async (event, context) => {
  const { order_id, carrier_code, tracking_number, pickup_confirmed } = event
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

    if (order.status !== 20) {
      const statusMap = { 10: '待付款', 30: '已发货', 40: '已完成', 50: '已取消' }
      return { success: false, message: `订单${statusMap[order.status] || '状态异常'}，无法发货` }
    }

    // ===== 2. 验证身份：确认操作者是该订单所属工坊的卖家 =====
    const workshopId = order.workshop_id || (order.product_snapshot && order.product_snapshot.workshop_id)
    if (!workshopId) {
      return { success: false, message: '订单数据异常：缺少工坊信息' }
    }

    // 查询工坊，验证 owner_id
    let workshopRes
    try {
      workshopRes = await db.collection('shopping_workshops').doc(workshopId).get()
    } catch (e) {
      return { success: false, message: '工坊信息不存在' }
    }

    if (workshopRes.data.owner_id !== openid) {
      console.warn(`[安全警告] ${openid} 尝试操作非本人工坊订单 ${order_id}`)
      return { success: false, message: '无权操作此订单' }
    }

    const logistics = (order.product_snapshot && order.product_snapshot.logistics) || {}
    const isPickupOrder = logistics.method === 'pickup' || order.carrier_code === 'pickup'

    if (isPickupOrder) {
      if (!pickup_confirmed) {
        return { success: false, message: '请先确认已当面交付商品' }
      }

      await db.collection('shopping_orders').doc(order_id).update({
        data: {
          status: 30,
          carrier_code: 'pickup',
          tracking_number: '',
          ship_time: db.serverDate(),
          update_time: db.serverDate()
        }
      })

      console.log(`[发货] 同城自提交付成功：卖家 ${openid}，订单 ${order_id}`)

      cloud.callFunction({
        name: 'send_notification',
        data: {
          type: 'TYPE_SHIPPED',
          touser: order._openid,
          page: `/pages/order/list?status=30`,
          payload: {
            productTitle: (order.product_snapshot && order.product_snapshot.title) || '商品',
            carrierCode: 'pickup',
            carrierName: '同城自提',
            trackingNumber: '同城自提'
          }
        }
      }).catch(e => console.warn('[ship_order] 发送通知失败（非阻塞）:', e))

      return { success: true, message: '已确认当面交付商品' }
    }

    // ===== 参数校验 =====
    if (!order_id || !carrier_code || !tracking_number) {
      return { success: false, message: '参数错误：缺少订单ID、快递公司或单号' }
    }
    if (tracking_number.trim().length < 5) {
      return { success: false, message: '快递单号格式不正确' }
    }

    // ===== 3. 更新订单：状态 20 → 30，写入物流信息 =====
    await db.collection('shopping_orders').doc(order_id).update({
      data: {
        status: 30,
        carrier_code: carrier_code.trim(),
        tracking_number: tracking_number.trim(),
        ship_time: db.serverDate(),
        update_time: db.serverDate()
      }
    })

    console.log(`[发货] 成功：卖家 ${openid}，订单 ${order_id}，单号 ${tracking_number}`)

    // ===== 4. 非阻塞：给买家发「发货提醒」订阅消息 =====
    const CARRIER_NAMES = {
      SF: '顺丰速运', YTO: '圆通快递', ZTO: '中通快递',
      STO: '申通快递', YUNDA: '韵达快递', JD: '京东快递',
      EMS: 'EMS邮政', OTHER: '其他快递'
    }
    cloud.callFunction({
      name: 'send_notification',
      data: {
        type: 'TYPE_SHIPPED',
        touser: order._openid,  // 买家 openid
        page: `/pages/order/list?status=30`,
        payload: {
          productTitle: (order.product_snapshot && order.product_snapshot.title) || '商品',
          carrierCode: carrier_code,
          carrierName: CARRIER_NAMES[carrier_code] || carrier_code,
          trackingNumber: tracking_number
        }
      }
    }).catch(e => console.warn('[ship_order] 发送通知失败（非阻塞）:', e))

    return { success: true, message: '发货成功' }

  } catch (err) {
    console.error('[ship_order 异常]', err)
    return { success: false, message: `发货失败：${err.message || '未知错误'}` }
  }
}
