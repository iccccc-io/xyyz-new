/**
 * 云函数：send_notification
 * 功能：发送微信订阅消息
 *
 * ============================================================
 * 接入前准备（部署前必读）：
 * 1. 登录微信公众平台 → 订阅消息 → 选用以下模板：
 *    - TYPE_SHIPPED (发货通知)：推荐模板「订单发货提醒」
 *      关键词：商品名称、快递公司、快递单号、发货时间
 *    - TYPE_SETTLED (到账通知)：推荐模板「收款到账通知」
 *      关键词：商品名称、到账金额、到账时间
 *    - TYPE_CANCELLED (取消通知)：推荐模板「订单取消通知」
 *      关键词：商品名称、取消原因、取消时间
 * 2. 将申请到的 templateId 填入下方 TEMPLATE_IDS
 * 3. 在 config.json 中开启 subscribeMessage.send 权限
 * 4. 前端页面需在适当时机调用 wx.requestSubscribeMessage 让用户授权
 * ============================================================
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// ===== 在此填入你在微信公众平台申请的订阅消息模板 ID =====
const TEMPLATE_IDS = {
  TYPE_SHIPPED:   'YOUR_SHIPPED_TEMPLATE_ID',    // 发货通知
  TYPE_SETTLED:   'YOUR_SETTLED_TEMPLATE_ID',    // 卖家到账通知
  TYPE_CANCELLED: 'YOUR_CANCELLED_TEMPLATE_ID',  // 订单取消通知
  TYPE_PAID:      'YOUR_PAID_TEMPLATE_ID'        // 支付成功通知（给卖家）
}

/**
 * 构造各类型消息的 data 字段
 */
function buildData(type, payload) {
  const now = new Date().toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  })

  switch (type) {
    case 'TYPE_SHIPPED':
      return {
        thing1:  { value: payload.productTitle || '商品' },    // 商品名称
        thing2:  { value: payload.carrierName || payload.carrierCode || '快递' }, // 快递公司
        character_string3: { value: payload.trackingNumber || '' }, // 快递单号
        time4:   { value: now }                                // 发货时间
      }

    case 'TYPE_SETTLED':
      return {
        thing1:  { value: payload.productTitle || '商品' },     // 商品名称
        amount2: { value: `¥${(payload.amount / 100).toFixed(2)}` }, // 到账金额
        time3:   { value: now }                                 // 到账时间
      }

    case 'TYPE_CANCELLED':
      return {
        thing1:  { value: payload.productTitle || '商品' },    // 商品名称
        thing2:  { value: payload.reason || '买家取消' },       // 取消原因
        time3:   { value: now }                                // 取消时间
      }

    case 'TYPE_PAID':
      return {
        thing1:  { value: payload.productTitle || '商品' },    // 商品名称
        amount2: { value: `¥${(payload.amount / 100).toFixed(2)}` }, // 订单金额
        time3:   { value: now }                                // 支付时间
      }

    default:
      return {}
  }
}

/**
 * @param {string}  event.type       - 消息类型（TYPE_SHIPPED / TYPE_SETTLED / TYPE_CANCELLED / TYPE_PAID）
 * @param {string}  event.touser     - 接收方 openid
 * @param {string}  event.page       - 点击通知后跳转的页面路径
 * @param {Object}  event.payload    - 消息内容（各字段见 buildData）
 *
 * @returns {{ success: boolean, message: string }}
 */
exports.main = async (event, context) => {
  const { type, touser, page, payload = {} } = event

  // ===== 参数校验 =====
  if (!type || !touser) {
    return { success: false, message: '参数错误：缺少 type 或 touser' }
  }

  const templateId = TEMPLATE_IDS[type]
  if (!templateId || templateId.startsWith('YOUR_')) {
    // 未配置模板 ID，静默跳过（不影响主流程）
    console.warn(`[send_notification] 模板 ${type} 未配置，跳过发送`)
    return { success: true, message: '模板未配置，已跳过（不影响业务）' }
  }

  const data = buildData(type, payload)

  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId,
      page: page || '/pages/order/list',
      data,
      miniprogramState: 'formal'  // developer / trial / formal
    })

    console.log(`[send_notification] ✓ 发送成功：${type} → ${touser}`)
    return { success: true, message: '消息发送成功' }

  } catch (err) {
    // 用户未订阅或 token 失效，不应影响主业务流程
    console.warn(`[send_notification] 发送失败（用户可能未订阅）:`, err.errCode, err.errMsg)
    return { success: false, message: err.errMsg || '发送失败', errCode: err.errCode }
  }
}
