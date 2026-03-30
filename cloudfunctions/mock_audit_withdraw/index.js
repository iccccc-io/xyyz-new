const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const withdrawalId = getSafeString(event.withdrawal_id)
  const decision = getSafeString(event.decision) || 'approve'

  if (!openid) {
    return { success: false, message: '请先登录' }
  }
  if (!withdrawalId) {
    return { success: false, message: '参数错误：缺少提现单号' }
  }
  if (!['approve', 'reject'].includes(decision)) {
    return { success: false, message: '无效的审批动作' }
  }

  try {
    const wallet = await ensureWallet(openid)
    const transaction = await db.startTransaction()

    try {
      const withdrawalRes = await transaction.collection('shopping_withdrawals').doc(withdrawalId).get()
      const withdrawal = withdrawalRes.data

      if (!withdrawal) {
        throw new Error('提现记录不存在')
      }
      if (withdrawal.user_id !== openid) {
        throw new Error('无权操作此提现记录')
      }
      if (toIntAmount(withdrawal.status) !== 0) {
        throw new Error('该提现申请已处理，请勿重复操作')
      }

      const amountFen = toIntAmount(withdrawal.amount)
      if (decision === 'approve') {
        await transaction.collection('shopping_withdrawals').doc(withdrawalId).update({
          data: {
            status: 1,
            audit_time: db.serverDate()
          }
        })

        await transaction.collection('shopping_wallets').doc(wallet._id).update({
          data: {
            total_withdrawn: _.inc(amountFen),
            update_time: db.serverDate()
          }
        })
      } else {
        await transaction.collection('shopping_withdrawals').doc(withdrawalId).update({
          data: {
            status: -1,
            audit_time: db.serverDate()
          }
        })

        await transaction.collection('shopping_wallets').doc(wallet._id).update({
          data: {
            balance: _.inc(amountFen),
            update_time: db.serverDate()
          }
        })

        await transaction.collection('shopping_ledger').add({
          data: {
            user_id: openid,
            ref_id: withdrawalId,
            amount: amountFen,
            type: 'WITHDRAW_REJECT',
            description: `提现申请被驳回，金额 ¥${(amountFen / 100).toFixed(2)} 已退回可用余额`,
            create_time: db.serverDate()
          }
        })
      }

      await transaction.commit()

      return {
        success: true,
        message: decision === 'approve' ? '模拟打款成功' : '已驳回提现并退回余额'
      }
    } catch (txErr) {
      await transaction.rollback().catch(() => {})
      throw txErr
    }
  } catch (err) {
    console.error('[mock_audit_withdraw]', err)
    return { success: false, message: err.message || '提现审批失败' }
  }
}
