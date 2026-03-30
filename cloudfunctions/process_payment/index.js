const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const HASH_PREFIX = 'sha256$'
const PAY_PASSWORD_SALT = 'xyyz_wallet_pwd_v1'

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toIntAmount(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.round(num) : fallback
}

function hashPayPassword(openid, password) {
  return `${HASH_PREFIX}${crypto
    .createHash('sha256')
    .update(`${PAY_PASSWORD_SALT}:${openid}:${password}`)
    .digest('hex')}`
}

function verifyPayPassword(storedPassword, openid, inputPassword) {
  const stored = getSafeString(storedPassword)
  const input = getSafeString(inputPassword)

  if (!stored) {
    return { ok: false, shouldUpgrade: false, reason: 'unset' }
  }
  if (!/^\d{6}$/.test(input)) {
    return { ok: false, shouldUpgrade: false, reason: 'format' }
  }

  if (stored.startsWith(HASH_PREFIX)) {
    return {
      ok: stored === hashPayPassword(openid, input),
      shouldUpgrade: false,
      reason: 'hash'
    }
  }

  if (/^\d{6}$/.test(stored)) {
    return {
      ok: stored === input,
      shouldUpgrade: stored === input,
      reason: 'legacy'
    }
  }

  return {
    ok: stored === hashPayPassword(openid, input),
    shouldUpgrade: false,
    reason: 'unknown'
  }
}

exports.main = async (event) => {
  const { order_id, pay_password } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!order_id || !pay_password) {
    return { success: false, message: '参数错误：缺少订单ID或支付密码' }
  }
  if (!/^\d{6}$/.test(getSafeString(pay_password))) {
    return { success: false, message: '支付密码必须是 6 位数字' }
  }

  let transaction = null

  try {
    transaction = await db.startTransaction()

    const orderRes = await transaction.collection('shopping_orders').doc(order_id).get()
    const order = orderRes.data
    if (!order) {
      throw new Error('订单不存在')
    }
    if (order._openid !== openid) {
      throw new Error('无权操作此订单')
    }
    if (Number(order.status) !== 10) {
      const statusMap = { 20: '已支付', 30: '待收货', 40: '已完成', 50: '已取消', 60: '售后中' }
      throw new Error(`订单${statusMap[order.status] || '状态异常'}，无法支付`)
    }

    const walletRes = await transaction.collection('shopping_wallets')
      .where({ _openid: openid })
      .limit(1)
      .get()
    if (!walletRes.data || !walletRes.data.length) {
      throw new Error('钱包不存在，请先进入钱包页初始化')
    }

    const wallet = walletRes.data[0]
    if (Number(wallet.status) === 2) {
      throw new Error('账户已被锁定，请联系客服')
    }

    const verifyRes = verifyPayPassword(wallet.pay_password, openid, pay_password)
    if (!verifyRes.ok) {
      throw new Error(verifyRes.reason === 'unset' ? '请先设置支付密码' : '支付密码错误，请重试')
    }

    const orderAmount = toIntAmount(order.total_price)
    const availableBalance = toIntAmount(wallet.balance)
    if (availableBalance < orderAmount) {
      throw new Error(`余额不足，还差 ¥${((orderAmount - availableBalance) / 100).toFixed(2)}`)
    }

    const payId = `PAY_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const productTitle = (order.product_snapshot && order.product_snapshot.title) || '订单商品'

    const walletUpdate = {
      balance: _.inc(-orderAmount),
      update_time: db.serverDate()
    }
    if (verifyRes.shouldUpgrade) {
      walletUpdate.pay_password = hashPayPassword(openid, pay_password)
    }

    await transaction.collection('shopping_wallets').doc(wallet._id).update({
      data: walletUpdate
    })

    await transaction.collection('shopping_orders').doc(order_id).update({
      data: {
        status: 20,
        pay_time: db.serverDate(),
        update_time: db.serverDate()
      }
    })

    await transaction.collection('shopping_ledger').add({
      data: {
        order_id,
        user_id: openid,
        amount: -orderAmount,
        type: 'PAYMENT',
        description: `支付订单：${productTitle}`,
        create_time: db.serverDate()
      }
    })

    await transaction.collection('shopping_pay_records').add({
      data: {
        pay_id: payId,
        order_id,
        fee: orderAmount,
        status: 1,
        pay_time: db.serverDate()
      }
    })

    await transaction.commit()

    return {
      success: true,
      message: '支付成功',
      pay_id: payId
    }
  } catch (err) {
    if (transaction) {
      await transaction.rollback().catch(() => {})
    }
    console.error('[process_payment]', err)
    return { success: false, message: err.message || '支付失败，请稍后重试' }
  }
}
