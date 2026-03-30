const app = getApp()

function formatFen(fen) {
  if (fen !== 0 && !fen) return '0.00'
  return (Number(fen) / 100).toFixed(2)
}

function formatTime(val) {
  if (!val) return ''
  const date = val instanceof Date ? val : new Date(val)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeWalletView(wallet = {}) {
  return {
    ...wallet,
    balanceDisplay: formatFen(wallet.balance),
    settlingDisplay: formatFen(wallet.settling_balance),
    frozenDisplay: formatFen(wallet.frozen_balance),
    totalIncomeDisplay: formatFen(wallet.total_income),
    totalWithdrawnDisplay: formatFen(wallet.total_withdrawn)
  }
}

function decorateLedgerItem(item = {}) {
  const amount = Number(item.amount) || 0
  let tone = 'neutral'
  let badge = '账单'

  if (item.type === 'PAYMENT') {
    tone = 'out'
    badge = '支付'
  } else if (item.type === 'REFUND') {
    tone = amount >= 0 ? 'in' : 'out'
    badge = '退款'
  } else if (item.type === 'SETTLED') {
    tone = 'in'
    badge = '结算'
  } else if (item.type === 'WITHDRAW_APPLY') {
    tone = 'out'
    badge = '提现'
  } else if (item.type === 'WITHDRAW_REJECT') {
    tone = 'in'
    badge = '驳回'
  }

  return {
    ...item,
    amount,
    amountDisplay: (Math.abs(amount) / 100).toFixed(2),
    timeDisplay: formatTime(item.create_time),
    tone,
    badge
  }
}

function decorateWithdrawal(item = {}) {
  const status = Number(item.status)
  let statusText = '处理中'
  let statusTone = 'pending'
  if (status === 1) statusText = '打款成功'
  if (status === 1) statusTone = 'success'
  if (status === -1) {
    statusText = '已驳回'
    statusTone = 'rejected'
  }

  return {
    ...item,
    amountDisplay: formatFen(item.amount),
    applyTimeDisplay: formatTime(item.apply_time),
    auditTimeDisplay: formatTime(item.audit_time),
    status,
    statusText,
    statusTone
  }
}

Page({
  data: {
    loading: true,
    isCreator: false,
    profile: null,
    wallet: null,
    accountForm: {
      type: 'alipay',
      account: '',
      name: ''
    },
    savingAccount: false,
    withdrawAmountInput: '',
    pendingWithdrawFen: 0,
    pendingWithdrawDisplay: '0.00',
    showWithdrawKeyboard: false,
    withdrawing: false,
    ledgerList: [],
    ledgerSkip: 0,
    ledgerHasMore: false,
    ledgerLoading: false,
    withdrawals: [],
    withdrawalsSkip: 0,
    withdrawalsHasMore: false,
    withdrawalsLoading: false
  },

  onLoad() {
    this.loadFinanceCenter()
  },

  onShow() {
    if (this.data.isCreator) {
      this.loadFinanceCenter()
    }
  },

  async loadFinanceCenter() {
    if (!app.checkLogin()) {
      app.requireLogin()
      return
    }

    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_wallet_secure',
        data: {
          action: 'get_finance_center',
          ledger_skip: 0,
          ledger_limit: 20,
          withdraw_skip: 0,
          withdraw_limit: 10
        }
      })

      const result = res.result || {}
      if (!result.success) {
        throw new Error(result.message || '财务中心加载失败')
      }

      this.setData({
        loading: false,
        isCreator: true,
        profile: result.profile || null,
        wallet: normalizeWalletView(result.wallet || {}),
        accountForm: {
          type: result.account_info && result.account_info.type ? result.account_info.type : 'alipay',
          account: result.account_info && result.account_info.account ? result.account_info.account : '',
          name: result.account_info && result.account_info.name ? result.account_info.name : ''
        },
        ledgerList: (result.ledger || []).map(decorateLedgerItem),
        ledgerSkip: (result.ledger || []).length,
        ledgerHasMore: !!result.ledger_has_more,
        withdrawals: (result.withdrawals || []).map(decorateWithdrawal),
        withdrawalsSkip: (result.withdrawals || []).length,
        withdrawalsHasMore: !!result.withdrawals_has_more
      })
    } catch (err) {
      console.error('加载财务中心失败:', err)
      this.setData({
        loading: false,
        isCreator: false
      })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  onAccountInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({
      [`accountForm.${field}`]: e.detail.value
    })
  },

  chooseAccountType() {
    wx.showActionSheet({
      itemList: ['支付宝', '微信收款'],
      success: (res) => {
        this.setData({
          'accountForm.type': res.tapIndex === 0 ? 'alipay' : 'wechat'
        })
      }
    })
  },

  async saveAccountInfo() {
    if (this.data.savingAccount) return

    this.setData({ savingAccount: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_wallet_secure',
        data: {
          action: 'save_account_info',
          account_info: this.data.accountForm
        }
      })

      const result = res.result || {}
      if (!result.success) {
        throw new Error(result.message || '保存失败')
      }

      this.setData({
        savingAccount: false,
        accountForm: {
          type: result.account_info && result.account_info.type ? result.account_info.type : this.data.accountForm.type,
          account: result.account_info && result.account_info.account ? result.account_info.account : this.data.accountForm.account,
          name: result.account_info && result.account_info.name ? result.account_info.name : this.data.accountForm.name
        }
      })
      wx.showToast({ title: result.message || '保存成功', icon: 'success' })
    } catch (err) {
      this.setData({ savingAccount: false })
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    }
  },

  onWithdrawAmountInput(e) {
    this.setData({ withdrawAmountInput: e.detail.value })
  },

  goToWallet() {
    wx.navigateTo({
      url: '/pages/wallet/index'
    })
  },

  startWithdraw() {
    const wallet = this.data.wallet || {}
    const amountText = String(this.data.withdrawAmountInput || '').trim()
    const amountFen = Math.round(Number(amountText) * 100)

    if (!amountText || Number.isNaN(Number(amountText)) || amountFen <= 0) {
      wx.showToast({ title: '请输入有效的提现金额', icon: 'none' })
      return
    }
    if (!this.data.accountForm.account || !this.data.accountForm.name) {
      wx.showToast({ title: '请先填写收款账户信息', icon: 'none' })
      return
    }
    if (!wallet.has_pay_password) {
      wx.showModal({
        title: '请先设置提现密码',
        content: '提现与支付共用同一套 6 位数字密码，是否前往钱包设置？',
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) this.goToWallet()
        }
      })
      return
    }
    if (amountFen > Number(wallet.balance || 0)) {
      wx.showToast({ title: '提现金额不能超过可用余额', icon: 'none' })
      return
    }

    this.setData({
      pendingWithdrawFen: amountFen,
      pendingWithdrawDisplay: formatFen(amountFen),
      showWithdrawKeyboard: true
    })
  },

  onWithdrawKeyboardClose() {
    this.setData({
      showWithdrawKeyboard: false,
      pendingWithdrawFen: 0,
      pendingWithdrawDisplay: '0.00',
      withdrawing: false
    })
  },

  async onWithdrawConfirm(e) {
    const password = e.detail.password
    const keyboard = this.selectComponent('#withdrawKeyboard')
    if (!this.data.pendingWithdrawFen) return

    this.setData({ withdrawing: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'apply_withdraw',
        data: {
          amount_fen: this.data.pendingWithdrawFen,
          pay_password: password
        }
      })

      const result = res.result || {}
      if (!result.success) {
        this.setData({ withdrawing: false })
        if (keyboard) keyboard.setError(result.message || '提现失败，请重试')
        return
      }

      this.setData({
        showWithdrawKeyboard: false,
        withdrawing: false,
        pendingWithdrawFen: 0,
        pendingWithdrawDisplay: '0.00',
        withdrawAmountInput: ''
      })
      wx.showToast({ title: result.message || '提现申请已提交', icon: 'success' })
      this.loadFinanceCenter()
    } catch (err) {
      this.setData({ withdrawing: false })
      if (keyboard) keyboard.setError('网络异常，请稍后重试')
    }
  },

  async mockApproveWithdrawal(e) {
    const withdrawalId = e.currentTarget.dataset.id
    if (!withdrawalId) return

    wx.showModal({
      title: '模拟打款',
      content: '确认将这笔提现申请标记为打款成功吗？',
      confirmText: '确认打款',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...', mask: true })
        try {
          const cfRes = await wx.cloud.callFunction({
            name: 'mock_audit_withdraw',
            data: {
              withdrawal_id: withdrawalId,
              decision: 'approve'
            }
          })
          wx.hideLoading()
          const result = cfRes.result || {}
          if (!result.success) {
            wx.showToast({ title: result.message || '处理失败', icon: 'none' })
            return
          }
          wx.showToast({ title: result.message || '模拟打款成功', icon: 'success' })
          this.loadFinanceCenter()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '处理失败', icon: 'none' })
        }
      }
    })
  },

  async loadMoreLedger() {
    if (this.data.ledgerLoading || !this.data.ledgerHasMore) return

    this.setData({ ledgerLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_wallet_secure',
        data: {
          action: 'load_ledger',
          skip: this.data.ledgerSkip,
          limit: 20
        }
      })
      const result = res.result || {}
      if (!result.success) {
        throw new Error(result.message || '账单加载失败')
      }
      const nextList = (result.list || []).map(decorateLedgerItem)
      this.setData({
        ledgerLoading: false,
        ledgerList: this.data.ledgerList.concat(nextList),
        ledgerSkip: this.data.ledgerSkip + nextList.length,
        ledgerHasMore: !!result.has_more
      })
    } catch (err) {
      this.setData({ ledgerLoading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  async loadMoreWithdrawals() {
    if (this.data.withdrawalsLoading || !this.data.withdrawalsHasMore) return

    this.setData({ withdrawalsLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_wallet_secure',
        data: {
          action: 'load_withdrawals',
          skip: this.data.withdrawalsSkip,
          limit: 10
        }
      })
      const result = res.result || {}
      if (!result.success) {
        throw new Error(result.message || '提现记录加载失败')
      }
      const nextList = (result.list || []).map(decorateWithdrawal)
      this.setData({
        withdrawalsLoading: false,
        withdrawals: this.data.withdrawals.concat(nextList),
        withdrawalsSkip: this.data.withdrawalsSkip + nextList.length,
        withdrawalsHasMore: !!result.has_more
      })
    } catch (err) {
      this.setData({ withdrawalsLoading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  onPullDownRefresh() {
    this.loadFinanceCenter().finally(() => wx.stopPullDownRefresh())
  }
})
