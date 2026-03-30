// pages/order/seller-list.js
const app = getApp()

const STATUS_MAP = {
  20: { text: '待发货', style: 'status-pending-ship' },
  30: { text: '已发货', style: 'status-shipped' },
  40: { text: '已完成', style: 'status-done' }
}

const SELLER_TABS = [
  { name: '20', label: '待发货' },
  { name: '30', label: '已发货' },
  { name: '40', label: '已完成' }
]

const CARRIERS = [
  { code: 'SF', name: '顺丰速运' },
  { code: 'YTO', name: '圆通快递' },
  { code: 'ZTO', name: '中通快递' },
  { code: 'STO', name: '申通快递' },
  { code: 'YUNDA', name: '韵达快递' },
  { code: 'JD', name: '京东快递' },
  { code: 'EMS', name: 'EMS邮政' },
  { code: 'OTHER', name: '其他快递' }
]

function formatFen(fen) {
  if (!fen && fen !== 0) return '0.00'
  return (fen / 100).toFixed(2)
}

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

function formatTime(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

function enrichOrder(order) {
  const snapshot = order.product_snapshot || {}
  const address = order.delivery_address || {}
  const info = STATUS_MAP[order.status] || { text: '未知', style: '' }
  const pickupOrder = (snapshot.logistics && snapshot.logistics.method === 'pickup') || order.carrier_code === 'pickup'
  return {
    ...order,
    shopName: snapshot.workshop_name || '湘韵遗珍工坊',
    categoryText: snapshot.category || '文创好物',
    projectName: snapshot.related_project_name || '',
    skuName: snapshot.sku_name || '',
    buyerName: address.userName || '',
    addressLine: address.userName
      ? `${address.userName} ${address.telNumber} | ${address.provinceName || ''}${address.cityName || ''}${address.countyName || ''} ${address.detailInfo || ''}`
      : '',
    statusText: info.text,
    statusStyle: info.style,
    totalDisplay: formatFen(order.total_price),
    productPriceDisplay: formatFen(snapshot.price || 0),
    shipTimeDisplay: formatTime(order.ship_time),
    isPickupOrder: pickupOrder,
    logisticsSummary: pickupOrder ? '同城自提，无需快递单号' : `${order.carrier_code || ''} ${order.tracking_number || ''}`.trim(),
    showLogisticsAction: pickupOrder || !!order.tracking_number,
    cardDelay: 0
  }
}

Page({
  data: {
    loading: true,
    stickyTopPx: 64,
    activeTab: '20',
    sellerTabs: SELLER_TABS,
    orders: [],
    hasMore: false,
    carriers: CARRIERS,
    searchValue: '',
    searchKeyword: '',
    resultCount: 0,
    showTimeFilterDrawer: false,
    hasActiveTimeFilter: false,
    activeTimeFilterSummary: '',
    draftTimeFilter: createDefaultTimeFilterDraft(),

    showShipDialog: false,
    shipping: false,
    shipTargetId: '',
    shipTargetIdx: -1,
    shipForm: {
      carrier_code: '',
      carrier_name: '',
      tracking_number: ''
    }
  },

  _skip: 0,
  _activeTimeFilter: null,

  onLoad() {
    this.setData({ stickyTopPx: getStickyTopPx() })
    this._skip = 0
    this.loadOrders(true)
  },

  onShow() {
    this._skip = 0
    this.loadOrders(true)
  },

  onPullDownRefresh() {
    this._skip = 0
    this.loadOrders(true).finally(() => wx.stopPullDownRefresh())
  },

  onTabChange(e) {
    const tab = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name) || (e.detail && e.detail.name)
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab, orders: [], showTimeFilterDrawer: false })
    this._skip = 0
    this.loadOrders(true)
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
    this.loadOrders(true)
  },

  async loadOrders(reset = false) {
    if (!app.checkLogin()) return

    if (reset) {
      this._skip = 0
      this.setData({ loading: true, orders: [] })
    }

    const LIMIT = 10
    const { activeTab, searchKeyword } = this.data

    try {
      const res = await wx.cloud.callFunction({
        name: 'get_seller_orders',
        data: {
          status: Number(activeTab),
          limit: LIMIT,
          skip: this._skip,
          keyword: searchKeyword,
          start_time: this._activeTimeFilter && this._activeTimeFilter.startDate
            ? this._activeTimeFilter.startDate.toISOString()
            : '',
          end_time: this._activeTimeFilter && this._activeTimeFilter.endDate
            ? this._activeTimeFilter.endDate.toISOString()
            : ''
        }
      })

      const result = res.result
      if (!result.success) {
        wx.showToast({ title: result.message || '加载失败', icon: 'none' })
        this.setData({ loading: false })
        return
      }

      const newOrders = (result.data || []).map((item, index) => ({
        ...enrichOrder(item),
        cardDelay: index * 60
      }))

      this.setData({
        orders: reset ? newOrders : [...this.data.orders, ...newOrders],
        hasMore: newOrders.length === LIMIT,
        resultCount: Number(result.total || 0),
        loading: false
      })

      this._skip += newOrders.length
    } catch (err) {
      console.error('加载销售订单失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    }
  },

  loadMore() {
    if (!this.data.hasMore) return
    this.loadOrders(false)
  },

  onEmptyAction() {
    if (this.data.searchKeyword || this.data.hasActiveTimeFilter) {
      this._activeTimeFilter = null
      this.setData({
        searchValue: '',
        searchKeyword: '',
        hasActiveTimeFilter: false,
        activeTimeFilterSummary: '',
        draftTimeFilter: createDefaultTimeFilterDraft(),
        showTimeFilterDrawer: false
      })
      this._skip = 0
      this.loadOrders(true)
      return
    }

    wx.navigateTo({ url: '/pages/product/publish' })
  },

  openShipDialog(e) {
    const { id, idx } = e.currentTarget.dataset
    const order = this.data.orders[Number(idx)]
    if (order && order.isPickupOrder) {
      wx.showModal({
        title: '确认交付',
        content: '同城自提无需填写物流单号。请确认你已经当面交付商品，确认后订单将进入“已发货”阶段。',
        confirmText: '确认交付',
        confirmColor: '#8B2E2A',
        success: (res) => {
          if (res.confirm) {
            this.submitPickupShip(id)
          }
        }
      })
      return
    }

    this.setData({
      showShipDialog: true,
      shipTargetId: id,
      shipTargetIdx: Number(idx),
      shipping: false,
      shipForm: { carrier_code: '', carrier_name: '', tracking_number: '' }
    })
  },

  async submitPickupShip(orderId) {
    if (!orderId || this.data.shipping) return

    this.setData({ shipping: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'ship_order',
        data: {
          order_id: orderId,
          pickup_confirmed: true
        }
      })

      const result = res.result
      if (result && result.success) {
        this.setData({ shipping: false })
        wx.showToast({ title: '交付成功', icon: 'success' })
        setTimeout(() => {
          this._skip = 0
          this.loadOrders(true)
        }, 800)
      } else {
        this.setData({ shipping: false })
        wx.showToast({ title: result.message || '操作失败', icon: 'none' })
      }
    } catch (err) {
      this.setData({ shipping: false })
      console.error('确认交付失败:', err)
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    }
  },

  closeShipDialog() {
    this.setData({ showShipDialog: false })
  },

  selectCarrier(e) {
    const { code, name } = e.currentTarget.dataset
    this.setData({ 'shipForm.carrier_code': code, 'shipForm.carrier_name': name })
  },

  onTrackingInput(e) {
    this.setData({ 'shipForm.tracking_number': e.detail })
  },

  async submitShip() {
    const { shipTargetId, shipForm, shipping } = this.data
    if (shipping) return

    if (!shipForm.carrier_code) {
      wx.showToast({ title: '请选择快递公司', icon: 'none' })
      return
    }
    if (!shipForm.tracking_number || shipForm.tracking_number.trim().length < 5) {
      wx.showToast({ title: '请输入有效的快递单号', icon: 'none' })
      return
    }

    this.setData({ shipping: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'ship_order',
        data: {
          order_id: shipTargetId,
          carrier_code: shipForm.carrier_code,
          tracking_number: shipForm.tracking_number.trim()
        }
      })

      const result = res.result
      if (result && result.success) {
        this.setData({ showShipDialog: false, shipping: false })
        wx.showToast({ title: '发货成功', icon: 'success' })
        setTimeout(() => {
          this._skip = 0
          this.loadOrders(true)
        }, 800)
      } else {
        this.setData({ shipping: false })
        wx.showToast({ title: result.message || '发货失败', icon: 'none' })
      }
    } catch (err) {
      this.setData({ shipping: false })
      console.error('发货失败:', err)
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    }
  },

  viewLogistics(e) {
    const id = e.currentTarget.dataset.id
    const isPickup = e.currentTarget.dataset.pickup === true || e.currentTarget.dataset.pickup === 'true'
    if (isPickup) {
      wx.showToast({ title: '同城自提无物流轨迹', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/order/logistics?orderId=${id}` })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/order/detail?id=${id}` })
  }
})
