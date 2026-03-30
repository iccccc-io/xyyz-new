const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const SETTLEMENT_BUFFER_MS = 7 * 24 * 60 * 60 * 1000
const BATCH_LIMIT = 100

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
    throw new Error('钱包初始化失败')
  }

  return res.data[0]
}

function getSettlementBaseTime(order = {}) {
  return order.confirm_time || order.complete_time || order.settle_deadline || null
}

function isOrderSettled(order = {}) {
  return order.is_settled === true || order.settled === true
}

function isReadyForSettlement(order = {}) {
  if (Number(order.status) !== 40) return false
  if (order.has_aftersale === true) return false
  if (isOrderSettled(order)) return false

  if (order.confirm_time) {
    const confirmMs = new Date(order.confirm_time).getTime()
    return Number.isFinite(confirmMs) && Date.now() - confirmMs >= SETTLEMENT_BUFFER_MS
  }

  if (order.settle_deadline) {
    const deadlineMs = new Date(order.settle_deadline).getTime()
    return Number.isFinite(deadlineMs) && Date.now() >= deadlineMs
  }

  const completeMs = new Date(order.complete_time).getTime()
  return Number.isFinite(completeMs) && Date.now() - completeMs >= SETTLEMENT_BUFFER_MS
}

exports.main = async () => {
  const stats = {
    success: true,
    settled_count: 0,
    scanned_count: 0,
    errors: []
  }

  try {
    const res = await db.collection('shopping_orders')
      .where({
        status: 40,
        has_aftersale: _.neq(true)
      })
      .field({
        _id: true,
        status: true,
        total_price: true,
        seller_openid: true,
        confirm_time: true,
        complete_time: true,
        settle_deadline: true,
        settled: true,
        is_settled: true,
        has_aftersale: true,
        'product_snapshot.title': true
      })
      .limit(BATCH_LIMIT)
      .get()

    const orders = res.data || []
    stats.scanned_count = orders.length

    for (const candidate of orders) {
      if (!isReadyForSettlement(candidate)) {
        continue
      }

      let transaction = null
      try {
        const sellerOpenid = getSafeString(candidate.seller_openid)
        const amountFen = toIntAmount(candidate.total_price)
        if (!sellerOpenid || amountFen <= 0) {
          continue
        }

        const wallet = await ensureWallet(sellerOpenid)
        transaction = await db.startTransaction()

        const [orderRes, walletRes] = await Promise.all([
          transaction.collection('shopping_orders').doc(candidate._id).get(),
          transaction.collection('shopping_wallets').doc(wallet._id).get()
        ])

        const order = orderRes.data || {}
        const sellerWallet = walletRes.data || {}

        if (!isReadyForSettlement(order)) {
          await transaction.rollback()
          transaction = null
          continue
        }

        const settlingBalance = toIntAmount(sellerWallet.settling_balance)
        if (settlingBalance < amountFen) {
          throw new Error(`卖家待结算金额不足，订单 ${candidate._id} 无法自动结算`)
        }

        await transaction.collection('shopping_wallets').doc(wallet._id).update({
          data: {
            settling_balance: _.inc(-amountFen),
            balance: _.inc(amountFen),
            total_income: _.inc(amountFen),
            update_time: db.serverDate()
          }
        })

        await transaction.collection('shopping_orders').doc(candidate._id).update({
          data: {
            is_settled: true,
            settled: true,
            settled_time: db.serverDate(),
            update_time: db.serverDate()
          }
        })

        await transaction.collection('shopping_ledger').add({
          data: {
            user_id: sellerOpenid,
            order_id: candidate._id,
            amount: amountFen,
            type: 'SETTLED',
            description: `订单 ${candidate._id} 结算入账`,
            create_time: db.serverDate()
          }
        })

        await transaction.commit()
        transaction = null
        stats.settled_count += 1
      } catch (err) {
        if (transaction) {
          await transaction.rollback().catch(() => {})
        }
        stats.errors.push({
          order_id: candidate._id,
          error: err.message
        })
      }
    }

    return stats
  } catch (err) {
    console.error('[auto_settlement]', err)
    return {
      success: false,
      settled_count: stats.settled_count,
      scanned_count: stats.scanned_count,
      errors: [...stats.errors, { error: err.message || '未知错误' }]
    }
  }
}
