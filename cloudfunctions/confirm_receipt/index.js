const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const SETTLEMENT_BUFFER_DAYS = 7
const INTERNAL_AUTO_CONFIRM_TOKEN = 'xyyz_confirm_auto_v1'

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toIntAmount(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.round(num) : fallback
}

function createWalletPayload(openid) {
  return {
    _openid: openid,
    balance: 0,
    settling_balance: 0,
    frozen_balance: 0,
    total_income: 0,
    total_withdrawn: 0,
    pay_password: '',
    status: 1,
    create_time: db.serverDate(),
    update_time: db.serverDate()
  }
}

async function ensureWallet(openid) {
  let res = await db.collection('shopping_wallets')
    .where({ _openid: openid })
    .limit(1)
    .get()

  if (!res.data || !res.data.length) {
    await db.collection('shopping_wallets').add({
      data: createWalletPayload(openid)
    })
    res = await db.collection('shopping_wallets')
      .where({ _openid: openid })
      .limit(1)
      .get()
  }

  if (!res.data || !res.data.length) {
    throw new Error('卖家钱包初始化失败')
  }

  return res.data[0]
}

exports.main = async (event) => {
  const { order_id } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const isInternalAuto = getSafeString(event._internal_token) === INTERNAL_AUTO_CONFIRM_TOKEN

  if (!order_id) {
    return { success: false, message: '参数错误：缺少订单ID' }
  }

  let transaction = null

  try {
    const orderPreviewRes = await db.collection('shopping_orders').doc(order_id).get()
    const orderPreview = orderPreviewRes.data
    if (!orderPreview) {
      return { success: false, message: '订单不存在' }
    }
    if (!isInternalAuto && orderPreview._openid !== openid) {
      return { success: false, message: '无权操作此订单' }
    }

    const sellerOpenid = getSafeString(
      orderPreview.seller_openid ||
      (orderPreview.product_snapshot && orderPreview.product_snapshot.seller_openid)
    )
    if (!sellerOpenid) {
      return { success: false, message: '订单数据异常：缺少卖家信息' }
    }

    const sellerWallet = await ensureWallet(sellerOpenid)
    const settleDeadline = new Date(Date.now() + SETTLEMENT_BUFFER_DAYS * 24 * 3600 * 1000)

    transaction = await db.startTransaction()
    const [orderRes, walletRes] = await Promise.all([
      transaction.collection('shopping_orders').doc(order_id).get(),
      transaction.collection('shopping_wallets').doc(sellerWallet._id).get()
    ])

    const order = orderRes.data
    const wallet = walletRes.data

    if (!order) {
      throw new Error('订单不存在')
    }
    if (!isInternalAuto && order._openid !== openid) {
      throw new Error('无权操作此订单')
    }
    if (Number(order.status) !== 30) {
      const statusMap = { 10: '待付款', 20: '待发货', 40: '已完成', 50: '已取消', 60: '售后中' }
      throw new Error(`订单${statusMap[order.status] || '状态异常'}，无法确认收货`)
    }

    const settlementAmount = toIntAmount(order.total_price)
    if (!wallet) {
      throw new Error('卖家钱包不存在')
    }

    await transaction.collection('shopping_orders').doc(order_id).update({
      data: {
        status: 40,
        confirm_time: db.serverDate(),
        complete_time: db.serverDate(),
        settle_deadline: settleDeadline,
        is_settled: false,
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
    transaction = null

    return { success: true, message: '确认收货成功，货款已进入待结算余额' }
  } catch (err) {
    if (transaction) {
      await transaction.rollback().catch(() => {})
    }
    console.error('[confirm_receipt]', err)
    return { success: false, message: err.message || '确认收货失败，请稍后重试' }
  }
}
