const app = getApp()
const db = wx.cloud.database()
const { createProductSummary } = require('../../common/mall-sku')

const CATEGORY_TABS = [
  { id: '全部', label: '全部' },
  { id: '手工体验', label: '手工体验' },
  { id: '非遗摆件', label: '非遗摆件' },
  { id: '文房雅器', label: '文房雅器' },
  { id: '地道风物', label: '地道风物' },
  { id: '服饰配件', label: '服饰配件' },
  { id: '家居装饰', label: '家居装饰' },
  { id: '文创礼品', label: '文创礼品' }
]

const PAGE_HORIZONTAL_PADDING_RPX = 20
const COLUMN_GAP_RPX = 16
const DEFAULT_IMAGE_RATIO = 1.18
const IMAGE_RATIO_BY_CATEGORY = {
  手工体验: 1.28,
  非遗摆件: 1.1,
  文房雅器: 1.24,
  地道风物: 1.02,
  服饰配件: 1.3,
  家居装饰: 1.16,
  文创礼品: 1.12
}

const DEFAULT_FILTER_STATE = {
  sortBy: 'sales_desc',
  priceRange: 'all',
  heritageCategory: 'all'
}

const FILTER_OPTIONS = {
  sortBy: [
    { id: 'sales_desc', label: '销量优先' },
    { id: 'price_asc', label: '价格从低到高' },
    { id: 'price_desc', label: '价格从高到低' },
    { id: 'newest', label: '最新上架' },
    { id: 'oldest', label: '最早上架' }
  ],
  priceRange: [
    { id: 'all', label: '全部价格' },
    { id: 'lt_100', label: '楼100以下' },
    { id: '100_300', label: '楼100-300' },
    { id: '300_600', label: '楼300-600' },
    { id: 'gte_600', label: '楼600以上' }
  ],
  heritageCategory: [
    { id: 'all', label: '全部类别' },
    { id: '手工体验', label: '手工体验' },
    { id: '非遗摆件', label: '非遗摆件' },
    { id: '文房雅器', label: '文房雅器' },
    { id: '地道风物', label: '地道风物' },
    { id: '服饰配件', label: '服饰配件' },
    { id: '家居装饰', label: '家居装饰' },
    { id: '文创礼品', label: '文创礼品' }
  ]
}

function truncateText(text, maxLen) {
  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max)
}

function getFallbackRatio(category) {
  return IMAGE_RATIO_BY_CATEGORY[category] || DEFAULT_IMAGE_RATIO
}

function getImageInfo(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null)
      return
    }

    wx.getImageInfo({
      src,
      success: (res) => resolve(res),
      fail: () => resolve(null)
    })
  })
}

function normalizeTime(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  const ts = new Date(value).getTime()
  return Number.isNaN(ts) ? 0 : ts
}

function getMenuSafeOffset(systemInfo) {
  if (!wx.getMenuButtonBoundingClientRect) return 0
  const rect = wx.getMenuButtonBoundingClientRect()
  const statusBarHeight = systemInfo.statusBarHeight || 20
  if (!rect || !rect.bottom) return 0
  return Math.max(0, rect.bottom - statusBarHeight + 8)
}

function getFilterCount(filterState) {
  return Object.keys(DEFAULT_FILTER_STATE).reduce((count, key) => (
    filterState[key] === DEFAULT_FILTER_STATE[key] ? count : count + 1
  ), 0)
}

Page({
  data: {
    statusBarHeight: 20,
    headerTopOffset: 0,
    searchValue: '',
    featuredProduct: null,
    categoryTabs: CATEGORY_TABS,
    activeCategory: '全部',
    leftColumn: [],
    rightColumn: [],
    loading: true,
    loadingMore: false,
    noMore: false,
    page: 0,
    pageSize: 10,
    showFilterPanel: false,
    activeFilterCount: 0,
    filterState: { ...DEFAULT_FILTER_STATE },
    draftFilterState: { ...DEFAULT_FILTER_STATE },
    sortOptions: FILTER_OPTIONS.sortBy,
    priceOptions: FILTER_OPTIONS.priceRange,
    heritageCategoryOptions: FILTER_OPTIONS.heritageCategory
  },

  onLoad() {
    const systemInfo = wx.getSystemInfoSync()
    const rpxToPx = systemInfo.screenWidth / 750

    this._columnWidthPx = (
      systemInfo.screenWidth -
      PAGE_HORIZONTAL_PADDING_RPX * 2 * rpxToPx -
      COLUMN_GAP_RPX * rpxToPx
    ) / 2
    this._leftColumnHeight = 0
    this._rightColumnHeight = 0
    this._workshopCache = {}

    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20,
      headerTopOffset: getMenuSafeOffset(systemInfo)
    })

    this.initializePage()
  },

  async initializePage() {
    await this.loadFeaturedProduct()
    await this.loadProducts(true)
  },

  buildWhereCondition() {
    const _ = db.command
    const searchValue = (this.data.searchValue || '').trim()
    const condition = {
      status: 1,
      total_stock: _.gt(0),
      is_on_sale: true
    }

    if (searchValue) {
      condition.title = db.RegExp({
        regexp: searchValue,
        options: 'i'
      })
    }

    if (this.data.activeCategory !== '全部') {
      condition.category = this.data.activeCategory
    }

    return condition
  },

  applyClientFilters(products) {
    const { filterState } = this.data
    let list = [...(products || [])]

    const getPrice = (item) => Number(item.min_price) || 0
    const getSales = (item) => Number(item.sales) || 0

    switch (filterState.priceRange) {
      case 'lt_100':
        list = list.filter((item) => getPrice(item) < 10000)
        break
      case '100_300':
        list = list.filter((item) => getPrice(item) >= 10000 && getPrice(item) <= 30000)
        break
      case '300_600':
        list = list.filter((item) => getPrice(item) > 30000 && getPrice(item) <= 60000)
        break
      case 'gte_600':
        list = list.filter((item) => getPrice(item) > 60000)
        break
      default:
        break
    }

    if (filterState.heritageCategory !== 'all') {
      list = list.filter((item) => item.category === filterState.heritageCategory)
    }

    switch (filterState.sortBy) {
      case 'price_asc':
        list.sort((a, b) => getPrice(a) - getPrice(b))
        break
      case 'price_desc':
        list.sort((a, b) => getPrice(b) - getPrice(a))
        break
      case 'newest':
        list.sort((a, b) => normalizeTime(b.create_time) - normalizeTime(a.create_time))
        break
      case 'oldest':
        list.sort((a, b) => normalizeTime(a.create_time) - normalizeTime(b.create_time))
        break
      default:
        list.sort((a, b) => getSales(b) - getSales(a))
        break
    }

    return list
  },

  shouldPinFeaturedCard() {
    return Boolean(
      this.data.featuredProduct &&
      !(this.data.searchValue || '').trim() &&
      this.data.activeCategory === '全部'
    )
  },

  async loadFeaturedProduct() {
    try {
      const _ = db.command
      const res = await db.collection('shopping_products')
        .where({
          status: 1,
          total_stock: _.gt(0),
          is_on_sale: true
        })
        .orderBy('sales', 'desc')
        .limit(1)
        .get()

      if (!res.data.length) {
        this.setData({ featuredProduct: null })
        return
      }

      const [item] = res.data
      const workshopMap = await this.loadWorkshopMeta(item.workshop_id ? [item.workshop_id] : [])
      const imageRatioMap = await this.loadImageRatioMap([item])

      this.setData({
        featuredProduct: this.normalizeProduct(item, workshopMap, imageRatioMap[item._id])
      })
    } catch (err) {
      console.error('加载推荐商品失败:', err)
    }
  },

  async loadWorkshopMeta(workshopIds) {
    const validIds = [...new Set((workshopIds || []).filter(Boolean))]
    if (!validIds.length) return this._workshopCache

    const missingIds = validIds.filter((id) => !this._workshopCache[id])
    if (!missingIds.length) return this._workshopCache

    const _ = db.command

    for (let index = 0; index < missingIds.length; index += 20) {
      const batchIds = missingIds.slice(index, index + 20)
      const res = await db.collection('shopping_workshops')
        .where({ _id: _.in(batchIds) })
        .field({
          _id: true,
          name: true,
          logo: true,
          ich_category: true
        })
        .get()

      ;(res.data || []).forEach((item) => {
        this._workshopCache[item._id] = item
      })
    }

    return this._workshopCache
  },

  async loadImageRatioMap(products) {
    if (!products || !products.length) return {}

    const cloudIds = [...new Set(
      products
        .map((item) => item.cover_img)
        .filter((src) => src && src.startsWith('cloud://'))
    )]

    const tempUrlMap = {}
    if (cloudIds.length) {
      try {
        const tempRes = await wx.cloud.getTempFileURL({ fileList: cloudIds })
        ;(tempRes.fileList || []).forEach((item) => {
          if (item.status === 0 && item.tempFileURL) {
            tempUrlMap[item.fileID] = item.tempFileURL
          }
        })
      } catch (err) {
        console.warn('获取商品临时图片链接失败:', err)
      }
    }

    const ratioEntries = await Promise.all(
      products.map(async (item) => {
        const rawSrc = item.cover_img || ''
        const imageSrc = rawSrc.startsWith('cloud://') ? tempUrlMap[rawSrc] : rawSrc
        let ratio = getFallbackRatio(item.category)

        if (imageSrc) {
          const info = await getImageInfo(imageSrc)
          if (info && info.width && info.height) {
            ratio = clamp(info.height / info.width, 0.72, 1.5)
          }
        }

        return [item._id, ratio]
      })
    )

    return ratioEntries.reduce((map, [id, ratio]) => {
      map[id] = ratio
      return map
    }, {})
  },

  normalizeProduct(item, workshopMap, imageRatio) {
    const summary = createProductSummary(item)
    const workshop = summary.workshop_id ? workshopMap[summary.workshop_id] || {} : {}
    const workshopName = workshop.name || summary.origin || '非遗工坊'
    const originText = summary.origin || workshop.ich_category || '湖南'

    return {
      ...summary,
      priceDisplay: `${summary.priceDisplay}${summary.priceSuffix}`,
      titleDisplay: truncateText(summary.title, 24),
      projectDisplayName: truncateText(summary.related_project_name || '', 14),
      originDisplay: truncateText(originText, 8),
      badgeText: summary.category || '匠作好物',
      workshopDisplayName: truncateText(workshopName, 8),
      workshopLogo: workshop.logo || '',
      workshopInitial: (workshopName || '匠').slice(0, 1),
      imageRatio: clamp(imageRatio || getFallbackRatio(summary.category), 0.72, 1.5)
    }
  },

  estimateCardHeight(item) {
    const imageHeight = this._columnWidthPx * (item.imageRatio || DEFAULT_IMAGE_RATIO)
    const titleLines = Math.min(2, Math.ceil(((item.title || '').length || 1) / 10))
    const titleHeight = titleLines * 22
    const tagHeight = item.projectDisplayName ? 30 : 26
    const footerHeight = 30
    const bodyPadding = 72
    return imageHeight + titleHeight + tagHeight + footerHeight + bodyPadding
  },

  distributeProducts(products, refresh) {
    let leftColumn = refresh ? [] : [...this.data.leftColumn]
    let rightColumn = refresh ? [] : [...this.data.rightColumn]
    let leftHeight = refresh ? 0 : this._leftColumnHeight || 0
    let rightHeight = refresh ? 0 : this._rightColumnHeight || 0

    products.forEach((item) => {
      if (refresh && this.shouldPinFeaturedCard() && this.data.featuredProduct && item._id === this.data.featuredProduct._id) {
        return
      }

      const estimatedHeight = this.estimateCardHeight(item)
      if (leftHeight <= rightHeight) {
        leftColumn.push(item)
        leftHeight += estimatedHeight
      } else {
        rightColumn.push(item)
        rightHeight += estimatedHeight
      }
    })

    this._leftColumnHeight = leftHeight
    this._rightColumnHeight = rightHeight

    return { leftColumn, rightColumn }
  },

  async loadProducts(refresh = false) {
    if (this.data.loadingMore && !refresh) return
    if (this.data.noMore && !refresh) return

    if (refresh) {
      this._leftColumnHeight = 0
      this._rightColumnHeight = 0
      this.setData({
        leftColumn: [],
        rightColumn: [],
        page: 0,
        noMore: false,
        loading: true
      })
    } else {
      this.setData({ loadingMore: true })
    }

    try {
      const currentPage = refresh ? 0 : this.data.page
      const { pageSize } = this.data
      const rawRes = await db.collection('shopping_products')
        .where(this.buildWhereCondition())
        .skip(currentPage * pageSize)
        .limit(pageSize)
        .orderBy('sales', 'desc')
        .get()

      const rawProducts = rawRes.data || []
      const products = this.applyClientFilters(rawProducts)
      if (rawProducts.length < pageSize) {
        this.setData({ noMore: true })
      }

      const workshopIds = [...new Set(products.map((item) => item.workshop_id).filter(Boolean))]
      const [workshopMap, imageRatioMap] = await Promise.all([
        this.loadWorkshopMeta(workshopIds),
        this.loadImageRatioMap(products)
      ])

      const normalizedProducts = products.map((item) =>
        this.normalizeProduct(item, workshopMap, imageRatioMap[item._id])
      )

      const { leftColumn, rightColumn } = this.distributeProducts(normalizedProducts, refresh)

      this.setData({
        leftColumn,
        rightColumn,
        page: currentPage + 1,
        loading: false,
        loadingMore: false
      })
    } catch (err) {
      console.error('加载商品列表失败:', err)
      this.setData({
        loading: false,
        loadingMore: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  onSearchInput(e) {
    this.setData({
      searchValue: e.detail.value
    })
  },

  onSearchConfirm() {
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    this.loadProducts(true)
  },

  onSearchClear() {
    if (!this.data.searchValue) return
    this.setData({ searchValue: '' })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    this.loadProducts(true)
  },

  onCategoryChange(e) {
    const { id } = e.currentTarget.dataset
    if (!id || id === this.data.activeCategory) return

    this.setData({
      activeCategory: id,
      showFilterPanel: false
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    this.loadProducts(true)
  },

  toggleFilterPanel() {
    const nextVisible = !this.data.showFilterPanel
    this.setData({
      showFilterPanel: nextVisible,
      draftFilterState: nextVisible ? { ...this.data.filterState } : this.data.draftFilterState
    })
  },

  onSelectFilterOption(e) {
    const { group, id } = e.currentTarget.dataset
    if (!group || !id) return
    this.setData({
      draftFilterState: {
        ...this.data.draftFilterState,
        [group]: id
      }
    })
  },

  onResetFilter() {
    this.setData({
      draftFilterState: { ...DEFAULT_FILTER_STATE }
    })
  },

  onApplyFilter() {
    const nextState = { ...this.data.draftFilterState }
    const changed = JSON.stringify(nextState) !== JSON.stringify(this.data.filterState)

    this.setData({
      filterState: nextState,
      activeFilterCount: getFilterCount(nextState),
      showFilterPanel: false
    })

    if (changed) {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      this.loadProducts(true)
    }
  },

  goToDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/mall/detail?id=${id}`
    })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateActive(2)
    }
    app.refreshChatUnreadBadge(this).catch(() => {})
  },

  async onPullDownRefresh() {
    await this.loadFeaturedProduct()
    await this.loadProducts(true)
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    this.loadProducts(false)
  },

  onShareAppMessage() {
    return {
      title: '湘韵遗珍 · 文创好物',
      path: '/pages/mall/home'
    }
  }
})
