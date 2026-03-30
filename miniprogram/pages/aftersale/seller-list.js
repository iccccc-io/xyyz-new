// pages/aftersale/seller-list.js
// 通过云函数 manage_aftersale(load_seller_list) 加载

const STATUS_TEXT = {
  0: '待审核',
  1: '待寄回',
  2: '待验收',
  3: '退款成功',
  '-1': '已拒绝',
  '-2': '已关闭'
}

const STATUS_COLOR = {
  0: '#ff9500',
  1: '#1989fa',
  2: '#8B6F47',
  3: '#10b981',
  '-1': '#ee0a24',
  '-2': '#999999'
}

const TAB_ITEMS = [
  { index: 0, label: '待处理' },
  { index: 1, label: '已完结' }
]

function fmtTime(val) {
  if (!val) return ''
  const d = typeof val === 'string' ? new Date(val) : (val instanceof Date ? val : new Date(val))
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
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

Page({
  data: {
    activeTab: 0,
    loading: true,
    stickyTopPx: 64,
    tabItems: TAB_ITEMS,
    list: [],
    closedList: [],
    pendingCount: 0,
    resultCount: 0,
    searchValue: '',
    searchKeyword: '',
    showTimeFilterDrawer: false,
    hasActiveTimeFilter: false,
    activeTimeFilterSummary: '',
    draftTimeFilter: createDefaultTimeFilterDraft()
  },

  _activeTimeFilter: null,

  onLoad() {
    this.setData({ stickyTopPx: getStickyTopPx() })
    this.loadData()
  },

  onShow() {
    this.loadData()
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh())
  },

  onTabChange(e) {
    const nextIndex = e.currentTarget && e.currentTarget.dataset
      ? Number(e.currentTarget.dataset.index)
      : Number(e.detail.index)
    if (Number.isNaN(nextIndex) || nextIndex === this.data.activeTab) return
    this.setData({ activeTab: nextIndex })
    this.updateResultCount(nextIndex)
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
      showTimeFilterDrawer: false
    })
    this.loadData()
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
      draftTimeFilter: cloneTimeFilterDraft(resolved.raw)
    })
    this.loadData()
  },

  onSearchInput(e) {
    const value = (e.detail && typeof e.detail.value === 'string') ? e.detail.value : ''
    this.setData({ searchValue: value })

    if (!value && this.data.searchKeyword) {
      this.setData({ searchKeyword: '' })
      this.loadData()
    }
  },

  onSearchConfirm() {
    const keyword = String(this.data.searchValue || '').trim()
    if (keyword === this.data.searchKeyword) return
    this.setData({
      searchValue: keyword,
      searchKeyword: keyword,
      showTimeFilterDrawer: false
    })
    this.loadData()
  },

  onSearchClear() {
    if (!this.data.searchValue && !this.data.searchKeyword) return
    this.setData({
      searchValue: '',
      searchKeyword: '',
      showTimeFilterDrawer: false
    })
    this.loadData()
  },

  updateResultCount(activeTab = this.data.activeTab) {
    const nextCount = activeTab === 0 ? this.data.list.length : this.data.closedList.length
    this.setData({ resultCount: nextCount })
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
      this.loadData()
      return
    }

    wx.navigateTo({ url: '/pages/order/seller-list' })
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const requestData = {
        keyword: this.data.searchKeyword,
        start_time: this._activeTimeFilter && this._activeTimeFilter.startDate
          ? this._activeTimeFilter.startDate.toISOString()
          : '',
        end_time: this._activeTimeFilter && this._activeTimeFilter.endDate
          ? this._activeTimeFilter.endDate.toISOString()
          : ''
      }

      const [activeRes, closedRes] = await Promise.all([
        wx.cloud.callFunction({
          name: 'manage_aftersale',
          data: {
            action: 'load_seller_list',
            status_filter: 'active',
            ...requestData
          }
        }),
        wx.cloud.callFunction({
          name: 'manage_aftersale',
          data: {
            action: 'load_seller_list',
            status_filter: 'closed',
            ...requestData
          }
        })
      ])

      const activeData = activeRes.result
      const closedData = closedRes.result

      const enrich = (item, orderMap, index) => {
        const orderInfo = (orderMap && orderMap[item.order_id]) || {}
        return {
          ...item,
          statusText: STATUS_TEXT[String(item.status)] || '未知',
          statusColor: STATUS_COLOR[String(item.status)] || '#999999',
          refundDisplay: ((item.refund_fee || 0) / 100).toFixed(2),
          applyTimeDisplay: fmtTime(item.apply_time),
          typeText: item.type === 'refund_only' ? '仅退款' : '退货退款',
          actionText: item.status === 0 ? '去处理' : item.status === 2 ? '去验收' : '查看详情',
          statusClass: item.status === 3
            ? 'status-success'
            : item.status < 0
              ? 'status-muted'
              : item.status === 2
                ? 'status-brown'
                : 'status-warn',
          orderInfo: {
            title: orderInfo.title || '',
            cover_img: orderInfo.cover_img || '',
            buyer_name: orderInfo.buyer_name || '',
            order_id: orderInfo.order_id || item.order_id,
            is_pickup: !!orderInfo.is_pickup
          },
          cardDelay: index * 60
        }
      }

      const activeList = activeData.success
        ? (activeData.list || []).map((item, index) => enrich(item, activeData.orderMap, index))
        : []
      const closedList = closedData.success
        ? (closedData.list || []).map((item, index) => enrich(item, closedData.orderMap, index))
        : []

      this.setData({
        loading: false,
        list: activeList,
        closedList,
        pendingCount: activeList.filter((item) => item.status === 0).length
      })
      this.updateResultCount(this.data.activeTab)
    } catch (err) {
      console.error('加载售后列表失败:', err)
      this.setData({ loading: false })
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/aftersale/detail?id=${id}&from=seller` })
  }
})
