const app = getApp()
const db = wx.cloud.database()

const ORDER_TABS = [
  { name: 'all', label: '全部' },
  { name: '10', label: '待付款' },
  { name: '20', label: '待发货' },
  { name: '30', label: '待收货' },
  { name: '40', label: '已完成' },
  { name: '60', label: '售后' }
]

const STATUS_MAP = {
  10: { text: '待付款', style: 'status-pending-pay' },
  20: { text: '待发货', style: 'status-pending-ship' },
  30: { text: '待收货', style: 'status-shipped' },
  40: { text: '已完成', style: 'status-done' },
  50: { text: '已取消', style: 'status-cancelled' },
  60: { text: '售后中', style: 'status-aftersale' }
}

const TIMEOUT_MS = 30 * 60 * 1000
const PAGE_LIMIT = 10
const SEARCH_FALLBACK_LIMIT = 200

function getStickyTopPx() {
  try {
    const systemInfo = wx.getSystemInfoSync()
    const statusBarHeight = systemInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect()
    const navHeight = (menuButton.top - statusBarHeight) * 2 + menuButton.height
    return statusBarHeight + (navHeight || 44)
  } catch (err) {
    return 64
  }
}

function formatFen(fen) {
  if (!fen && fen !== 0) return '0.00'
  return (fen / 100).toFixed(2)
}

function formatTime(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getReviewState(order) {
  const reviewStatus = Number(order && order.review_status) === 1 ? 1 : 0
  const reviewId = typeof (order && order.review_id) === 'string' ? order.review_id : ''
  const canReview = Number(order && order.status) === 40 && order && order.has_aftersale !== true

  return {
    reviewStatus,
    reviewId,
    canReview,
    reviewButtonText: reviewStatus === 1 ? '我的评价' : '去评价'
  }
}

function calcCountdown(createTime) {
  if (!createTime) return { countdown: 0, countdownDisplay: '' }
  const deadline = new Date(createTime).getTime() + TIMEOUT_MS
  const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000))

  if (remaining === 0) {
    return { countdown: 0, countdownDisplay: '' }
  }

  const pad = (n) => String(n).padStart(2, '0')
  return {
    countdown: remaining,
    countdownDisplay: `${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`
  }
}

function escapeRegExpKeyword(keyword) {
  return String(keyword || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function padNumber(n) {
  return String(n).padStart(2, '0')
}

function formatMonthLabel(value) {
  if (!value) return ''
  const parts = String(value).split('-')
  if (parts.length < 2) return value
  return `${parts[0]}年${parts[1]}月`
}

function formatDayLabel(value) {
  if (!value) return ''
  const parts = String(value).split('-')
  if (parts.length < 3) return value
  return `${parts[0]}年${parts[1]}月${parts[2]}日`
}

function decorateTimeFilterDraft(filter) {
  const draft = { ...filter }
  draft.yearSingleLabel = `${draft.yearSingle}年`
  draft.yearStartLabel = `${draft.yearStart}年`
  draft.yearEndLabel = `${draft.yearEnd}年`
  draft.monthSingleLabel = formatMonthLabel(draft.monthSingle)
  draft.monthStartLabel = formatMonthLabel(draft.monthStart)
  draft.monthEndLabel = formatMonthLabel(draft.monthEnd)
  draft.daySingleLabel = formatDayLabel(draft.daySingle)
  draft.dayStartLabel = formatDayLabel(draft.dayStart)
  draft.dayEndLabel = formatDayLabel(draft.dayEnd)
  return draft
}

function createDefaultTimeFilterDraft() {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = `${year}-${padNumber(now.getMonth() + 1)}`
  const day = `${month}-${padNumber(now.getDate())}`

  return decorateTimeFilterDraft({
    granularity: 'month',
    type: 'single',
    yearSingle: year,
    yearStart: year,
    yearEnd: year,
    monthSingle: month,
    monthStart: month,
    monthEnd: month,
    daySingle: day,
    dayStart: day,
    dayEnd: day
  })
}

function cloneTimeFilterDraft(filter) {
  return decorateTimeFilterDraft(JSON.parse(JSON.stringify(filter)))
}

function resolveTimeFilterDraft(filter) {
  const draft = cloneTimeFilterDraft(filter)
  let startDate = null
  let endDate = null
  let summary = ''

  if (draft.granularity === 'year') {
    if (draft.type === 'single') {
      const year = Number(draft.yearSingle)
      startDate = new Date(year, 0, 1, 0, 0, 0, 0)
      endDate = new Date(year + 1, 0, 1, 0, 0, 0, 0)
      summary = `${draft.yearSingle}年`
    } else {
      const startYear = Number(draft.yearStart)
      const endYear = Number(draft.yearEnd)
      if (startYear > endYear) return null
      startDate = new Date(startYear, 0, 1, 0, 0, 0, 0)
      endDate = new Date(endYear + 1, 0, 1, 0, 0, 0, 0)
      summary = `${draft.yearStart}年 - ${draft.yearEnd}年`
    }
  } else if (draft.granularity === 'month') {
    if (draft.type === 'single') {
      const [year, month] = String(draft.monthSingle).split('-').map(Number)
      startDate = new Date(year, month - 1, 1, 0, 0, 0, 0)
      endDate = new Date(year, month, 1, 0, 0, 0, 0)
      summary = formatMonthLabel(draft.monthSingle)
    } else {
      const [startYear, startMonth] = String(draft.monthStart).split('-').map(Number)
      const [endYear, endMonth] = String(draft.monthEnd).split('-').map(Number)
      const startTime = new Date(startYear, startMonth - 1, 1, 0, 0, 0, 0).getTime()
      const endTime = new Date(endYear, endMonth - 1, 1, 0, 0, 0, 0).getTime()
      if (startTime > endTime) return null
      startDate = new Date(startYear, startMonth - 1, 1, 0, 0, 0, 0)
      endDate = new Date(endYear, endMonth, 1, 0, 0, 0, 0)
      summary = `${formatMonthLabel(draft.monthStart)} - ${formatMonthLabel(draft.monthEnd)}`
    }
  } else {
    if (draft.type === 'single') {
      startDate = new Date(`${draft.daySingle}T00:00:00`)
      endDate = new Date(startDate)
      endDate.setDate(endDate.getDate() + 1)
      summary = formatDayLabel(draft.daySingle)
    } else {
      const start = new Date(`${draft.dayStart}T00:00:00`)
      const end = new Date(`${draft.dayEnd}T00:00:00`)
      if (start.getTime() > end.getTime()) return null
      startDate = start
      endDate = new Date(end)
      endDate.setDate(endDate.getDate() + 1)
      summary = `${formatDayLabel(draft.dayStart)} - ${formatDayLabel(draft.dayEnd)}`
    }
  }

  return {
    raw: draft,
    granularity: draft.granularity,
    type: draft.type,
    summary,
    startDate,
    endDate
  }
}

function matchesSearchKeyword(order, keyword) {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase()
  if (!normalizedKeyword) return true

  const snapshot = order.product_snapshot || {}
  const fields = [
    snapshot.title,
    snapshot.workshop_name,
    snapshot.sku_name
  ]

  return fields.some((field) => String(field || '').toLowerCase().includes(normalizedKeyword))
}

function buildOrderWhere(openid, activeTab, keyword, activeTimeFilter) {
  const _ = db.command
  const conditions = [{ _openid: openid }]

  if (activeTab === '60') {
    conditions.push(_.or([{ status: 60 }, { has_aftersale: true }]))
  } else if (activeTab !== 'all') {
    conditions.push({ status: Number(activeTab) })
  }

  const trimmedKeyword = String(keyword || '').trim()
  if (trimmedKeyword) {
    const keywordRegExp = db.RegExp({
      regexp: escapeRegExpKeyword(trimmedKeyword),
      options: 'i'
    })

    conditions.push(_.or([
      { 'product_snapshot.title': keywordRegExp },
      { 'product_snapshot.workshop_name': keywordRegExp },
      { 'product_snapshot.sku_name': keywordRegExp }
    ]))
  }

  if (activeTimeFilter && activeTimeFilter.startDate && activeTimeFilter.endDate) {
    conditions.push({ create_time: _.gte(activeTimeFilter.startDate) })
    conditions.push({ create_time: _.lt(activeTimeFilter.endDate) })
  }

  return conditions.length === 1 ? conditions[0] : _.and(conditions)
}

function enrichOrder(order, index = 0, withDelay = false) {
  let info = STATUS_MAP[order.status] || { text: '未知状态', style: '' }

  if (order.status === 40 && order.has_aftersale) {
    info = { text: '售后中', style: 'status-aftersale' }
  }

  if (order.status === 60 && (order.aftersale_result === 'refunded' || order.settled === true)) {
    info = { text: '已退款', style: 'status-refunded' }
  }

  const snapshot = order.product_snapshot || {}
  const countdownInfo = order.status === 10 ? calcCountdown(order.create_time) : {}
  const reviewState = getReviewState(order)

  return {
    ...order,
    shopName: snapshot.workshop_name || '湘韵遗珍工坊',
    projectName: snapshot.related_project_name || '',
    categoryText: snapshot.category || '文创好物',
    statusText: info.text,
    statusStyle: info.style,
    totalDisplay: formatFen(order.total_price),
    productPriceDisplay: formatFen(snapshot.price || 0),
    createTimeDisplay: formatTime(order.create_time),
    cardDelay: withDelay ? index * 70 : 0,
    ...reviewState,
    ...countdownInfo
  }
}

Page({
  data: {
    loading: true,
    stickyTopPx: 64,
    searchValue: '',
    searchKeyword: '',
    showTimeFilterDrawer: false,
    hasActiveTimeFilter: false,
    activeTimeFilterSummary: '',
    isFilterBreathing: false,
    draftTimeFilter: createDefaultTimeFilterDraft(),
    activeTab: 'all',
    orderTabs: ORDER_TABS,
    orders: [],
    hasMore: false,
    isTabSwitching: false,
    showPayKeyboard: false,
    paying: false,
    payAmountDisplay: '0.00',
    pendingOrderId: '',
    pendingOrderIdx: -1
  },

  _countdownTimer: null,
  _switchTimer: null,
  _filterPulseTimer: null,
  _skip: 0,
  _activeTimeFilter: null,

  _startCountdownRefresh() {
    this._stopCountdownRefresh()
    this._countdownTimer = setInterval(() => {
      const orders = this.data.orders
      const hasPending = orders.some((item) => item.status === 10)

      if (!hasPending) {
        this._stopCountdownRefresh()
        return
      }

      const updated = orders.map((item) => {
        if (item.status !== 10) return item
        return { ...item, ...calcCountdown(item.create_time) }
      })

      this.setData({ orders: updated })
    }, 1000)
  },

  _stopCountdownRefresh() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  },

  _triggerTabAnimation() {
    this.setData({ isTabSwitching: true })
    if (this._switchTimer) clearTimeout(this._switchTimer)
    this._switchTimer = setTimeout(() => {
      this.setData({ isTabSwitching: false })
    }, 260)
  },

  async _loadOrdersWithFallback({ openid, activeTab, searchKeyword, reset }) {
    const fallbackWhere = buildOrderWhere(openid, activeTab, '', this._activeTimeFilter)
    const fallbackRes = await db.collection('shopping_orders')
      .where(fallbackWhere)
      .orderBy('create_time', 'desc')
      .limit(SEARCH_FALLBACK_LIMIT)
      .get()

    const filteredOrders = (fallbackRes.data || []).filter((item) => matchesSearchKeyword(item, searchKeyword))
    const start = reset ? 0 : this._skip
    const slicedOrders = filteredOrders.slice(start, start + PAGE_LIMIT)
    const newOrders = slicedOrders.map((item, index) => enrichOrder(item, index, reset))
    const mergedOrders = reset ? newOrders : [...this.data.orders, ...newOrders]

    this.setData({
      orders: mergedOrders,
      hasMore: start + PAGE_LIMIT < filteredOrders.length,
      loading: false
    })

    this._skip = start + newOrders.length

    if (mergedOrders.some((item) => item.status === 10)) {
      this._startCountdownRefresh()
    } else {
      this._stopCountdownRefresh()
    }
  },

  onLoad(options) {
    const statusParam = options.status
    const tabMap = { '10': '10', '20': '20', '30': '30', '40': '40', '60': '60' }
    const activeTab = tabMap[statusParam] || 'all'

    this.setData({
      activeTab,
      stickyTopPx: getStickyTopPx()
    })

    this._skip = 0
    this.loadOrders(true)
  },

  onShow() {
    this._skip = 0
    this.loadOrders(true)
  },

  onUnload() {
    this._stopCountdownRefresh()
    if (this._switchTimer) {
      clearTimeout(this._switchTimer)
      this._switchTimer = null
    }
    if (this._filterPulseTimer) {
      clearTimeout(this._filterPulseTimer)
      this._filterPulseTimer = null
    }
  },

  onPullDownRefresh() {
    this._skip = 0
    this.loadOrders(true).finally(() => wx.stopPullDownRefresh())
  },

  triggerFilterBreathing() {
    this.setData({ isFilterBreathing: true })
    if (this._filterPulseTimer) clearTimeout(this._filterPulseTimer)
    this._filterPulseTimer = setTimeout(() => {
      this.setData({ isFilterBreathing: false })
    }, 900)
  },

  toggleTimeFilterDrawer() {
    const nextVisible = !this.data.showTimeFilterDrawer
    let nextDraft = this.data.draftTimeFilter

    if (nextVisible) {
      nextDraft = this._activeTimeFilter
        ? cloneTimeFilterDraft(this._activeTimeFilter.raw)
        : createDefaultTimeFilterDraft()
    }

    this.setData({
      showTimeFilterDrawer: nextVisible,
      draftTimeFilter: nextDraft
    })
  },

  selectTimeGranularity(e) {
    const value = e.currentTarget.dataset.value
    if (!value || value === this.data.draftTimeFilter.granularity) return

    this.setData({
      draftTimeFilter: decorateTimeFilterDraft({
        ...this.data.draftTimeFilter,
        granularity: value
      })
    })
  },

  selectTimeType(e) {
    const value = e.currentTarget.dataset.value
    if (!value || value === this.data.draftTimeFilter.type) return

    this.setData({
      draftTimeFilter: decorateTimeFilterDraft({
        ...this.data.draftTimeFilter,
        type: value
      })
    })
  },

  onTimePickerChange(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail && e.detail.value
    if (!field || !value) return

    this.setData({
      draftTimeFilter: decorateTimeFilterDraft({
        ...this.data.draftTimeFilter,
        [field]: value
      })
    })
  },

  onResetTimeFilter() {
    this._activeTimeFilter = null
    this.setData({
      draftTimeFilter: createDefaultTimeFilterDraft(),
      hasActiveTimeFilter: false,
      activeTimeFilterSummary: '',
      showTimeFilterDrawer: false,
      orders: []
    })
    this._skip = 0
    this._triggerTabAnimation()
    this.loadOrders(true)
  },

  onApplyTimeFilter() {
    const resolved = resolveTimeFilterDraft(this.data.draftTimeFilter)
    if (!resolved) {
      wx.showToast({
        title: '开始时间不能晚于结束时间',
        icon: 'none'
      })
      return
    }

    this._activeTimeFilter = resolved
    this.setData({
      showTimeFilterDrawer: false,
      hasActiveTimeFilter: true,
      activeTimeFilterSummary: resolved.summary,
      draftTimeFilter: cloneTimeFilterDraft(resolved.raw),
      orders: []
    })
    this._skip = 0
    this._triggerTabAnimation()
    this.triggerFilterBreathing()
    this.loadOrders(true)
  },

  onSearchInput(e) {
    const value = (e.detail && typeof e.detail.value === 'string') ? e.detail.value : ''
    this.setData({ searchValue: value })

    if (!value && this.data.searchKeyword) {
      this.setData({
        searchKeyword: '',
        orders: []
      })
      this._skip = 0
      this._triggerTabAnimation()
      this.loadOrders(true)
    }
  },

  onSearchConfirm() {
    const keyword = String(this.data.searchValue || '').trim()
    if (keyword === this.data.searchKeyword) return

    this.setData({
      searchValue: keyword,
      searchKeyword: keyword,
      showTimeFilterDrawer: false,
      orders: []
    })
    this._skip = 0
    this._triggerTabAnimation()
    this.loadOrders(true)
  },

  onSearchClear() {
    if (!this.data.searchValue && !this.data.searchKeyword) return

    this.setData({
      searchValue: '',
      searchKeyword: '',
      showTimeFilterDrawer: false,
      orders: []
    })
    this._skip = 0
    this._triggerTabAnimation()
    this.loadOrders(true)
  },

  onTabChange(e) {
    const tab = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name) || (e.detail && e.detail.name)
    if (!tab || tab === this.data.activeTab) return

    this.setData({
      activeTab: tab,
      showTimeFilterDrawer: false,
      orders: []
    })
    this._triggerTabAnimation()
    this._skip = 0
    this.loadOrders(true)
  },

  async loadOrders(reset = false) {
    if (!app.checkLogin()) return

    const openid = app.globalData.openid
    if (!openid) return

    if (reset) {
      this._skip = 0
      this.setData({
        loading: true,
        orders: []
      })
    }

    const { activeTab, searchKeyword } = this.data

    try {
      const whereCondition = buildOrderWhere(openid, activeTab, searchKeyword, this._activeTimeFilter)
      const res = await db.collection('shopping_orders')
        .where(whereCondition)
        .orderBy('create_time', 'desc')
        .skip(this._skip)
        .limit(PAGE_LIMIT)
        .get()

      const newOrders = (res.data || []).map((item, index) => enrichOrder(item, index, reset))
      const mergedOrders = reset ? newOrders : [...this.data.orders, ...newOrders]

      this.setData({
        orders: mergedOrders,
        hasMore: newOrders.length === PAGE_LIMIT,
        loading: false
      })

      this._skip += newOrders.length

      if (mergedOrders.some((item) => item.status === 10)) {
        this._startCountdownRefresh()
      } else {
        this._stopCountdownRefresh()
      }
    } catch (err) {
      if (!searchKeyword) {
        console.error('加载订单失败:', err)
        this.setData({ loading: false })
        this._stopCountdownRefresh()
        return
      }

      try {
        await this._loadOrdersWithFallback({
          openid,
          activeTab,
          searchKeyword,
          reset
        })
      } catch (fallbackErr) {
        console.error('搜索订单失败:', fallbackErr)
        this.setData({ loading: false })
        this._stopCountdownRefresh()
        wx.showToast({
          title: '搜索失败，请稍后重试',
          icon: 'none'
        })
      }
    }
  },

  loadMore() {
    if (!this.data.hasMore) return
    this.loadOrders(false)
  },

  cancelOrder(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '取消订单',
      content: '确定要取消此订单吗？',
      confirmText: '确认取消',
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (!res.confirm) return

        wx.showLoading({ title: '取消中...', mask: true })
        try {
          const cfRes = await wx.cloud.callFunction({
            name: 'cancel_order',
            data: { order_id: id }
          })
          wx.hideLoading()

          const result = cfRes.result
          if (result && result.success) {
            wx.showToast({ title: '订单已取消', icon: 'success' })
            setTimeout(() => {
              this._skip = 0
              this.loadOrders(true)
            }, 800)
          } else {
            wx.showToast({ title: result.message || '取消失败', icon: 'none' })
          }
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '取消失败，请重试', icon: 'none' })
        }
      }
    })
  },

  payOrder(e) {
    const { id, total, idx } = e.currentTarget.dataset
    this.setData({
      pendingOrderId: id,
      pendingOrderIdx: Number(idx),
      payAmountDisplay: total,
      showPayKeyboard: true
    })
  },

  closePayKeyboard() {
    this.setData({
      showPayKeyboard: false,
      pendingOrderId: '',
      pendingOrderIdx: -1
    })
  },

  async onPayConfirm(e) {
    const { password } = e.detail
    const { pendingOrderId } = this.data
    if (!pendingOrderId) return

    this.setData({ paying: true })
    const keyboard = this.selectComponent('#payKeyboard')

    try {
      const res = await wx.cloud.callFunction({
        name: 'process_payment',
        data: { order_id: pendingOrderId, pay_password: password }
      })
      const result = res.result

      if (result && result.success) {
        this.setData({
          showPayKeyboard: false,
          paying: false
        })
        wx.showToast({ title: '支付成功', icon: 'success' })
        setTimeout(() => {
          this._skip = 0
          this.loadOrders(true)
        }, 800)
      } else {
        this.setData({ paying: false })
        if (keyboard) keyboard.setError(result.message || '支付失败')
      }
    } catch (err) {
      this.setData({ paying: false })
      if (keyboard) keyboard.setError('网络异常，请重试')
    }
  },

  confirmReceipt(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '确认收货',
      content: '请确认您已收到商品。确认后将进入售后保障期。',
      confirmText: '确认收货',
      confirmColor: '#8B2E2A',
      success: async (res) => {
        if (!res.confirm) return

        wx.showLoading({ title: '处理中...', mask: true })
        try {
          const cfRes = await wx.cloud.callFunction({
            name: 'confirm_receipt',
            data: { order_id: id }
          })
          wx.hideLoading()

          const result = cfRes.result
          if (result && result.success) {
            wx.showToast({ title: '收货确认成功', icon: 'success' })
            setTimeout(() => {
              this._skip = 0
              this.loadOrders(true)
            }, 800)
          } else {
            wx.showToast({ title: result.message || '操作失败', icon: 'none' })
          }
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '网络异常，请重试', icon: 'none' })
        }
      }
    })
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/order/detail?id=${id}` })
  },

  viewLogistics(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/order/logistics?orderId=${id}` })
  },

  goToReviewSubmit(e) {
    const orderId = e.currentTarget.dataset.id
    if (!orderId) return
    wx.navigateTo({ url: `/pages/review/submit?orderId=${orderId}` })
  },

  goToReviewDetail(e) {
    const reviewId = e.currentTarget.dataset.reviewId
    if (!reviewId) {
      wx.showToast({ title: '评价信息不存在', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/review/detail?reviewId=${reviewId}` })
  },

  async viewAftersale(e) {
    const orderId = e.currentTarget.dataset.id
    wx.showLoading({ title: '加载中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_aftersale',
        data: {
          action: 'load_detail',
          order_id: orderId
        }
      })
      wx.hideLoading()

      const result = res.result
      if (result && result.success && result.detail) {
        wx.navigateTo({ url: `/pages/aftersale/detail?id=${result.detail._id}` })
      } else {
        wx.showToast({ title: '未找到售后记录', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '查询失败', icon: 'none' })
    }
  },

  goToMall() {
    wx.switchTab({ url: '/pages/mall/home' })
  }
})
