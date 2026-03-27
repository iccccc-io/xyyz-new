const db = wx.cloud.database()

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
  '手工体验': 1.28,
  '非遗摆件': 1.1,
  '文房雅器': 1.24,
  '地道风物': 1.02,
  '服饰配件': 1.3,
  '家居装饰': 1.16,
  '文创礼品': 1.12
}

function formatPrice(fen) {
  if (!fen && fen !== 0) return '0.00'
  const amount = Number(fen)
  if (Number.isNaN(amount) || !Number.isFinite(amount)) return '0.00'

  const yuan = amount / 100
  if (yuan >= 100000000) {
    return (yuan / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
  }
  if (yuan >= 10000) {
    return (yuan / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  }
  return yuan.toFixed(2).replace(/\.?0+$/, '') || '0'
}

function truncateText(text, maxLen) {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
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

Page({
  data: {
    statusBarHeight: 20,
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
    pageSize: 10
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
      statusBarHeight: systemInfo.statusBarHeight || 20
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
      stock: _.gt(0)
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
          stock: _.gt(0)
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
        .where({
          _id: _.in(batchIds)
        })
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
    const workshop = item.workshop_id ? workshopMap[item.workshop_id] || {} : {}
    const workshopName = workshop.name || item.origin || '非遗工坊'
    const originText = item.origin || workshop.ich_category || '湖南'

    return {
      ...item,
      priceDisplay: formatPrice(item.price),
      originalPriceDisplay: item.original_price ? formatPrice(item.original_price) : '',
      titleDisplay: truncateText(item.title, 24),
      projectDisplayName: truncateText(item.related_project_name || '', 14),
      originDisplay: truncateText(originText, 8),
      badgeText: item.category || '匠作好物',
      workshopDisplayName: truncateText(workshopName, 8),
      workshopLogo: workshop.logo || '',
      workshopInitial: (workshopName || '匠').slice(0, 1),
      imageRatio: clamp(imageRatio || getFallbackRatio(item.category), 0.72, 1.5)
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
      const res = await db.collection('shopping_products')
        .where(this.buildWhereCondition())
        .skip(currentPage * pageSize)
        .limit(pageSize)
        .orderBy('sales', 'desc')
        .get()

      const products = res.data || []
      if (products.length < pageSize) {
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
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 0
    })
    this.loadProducts(true)
  },

  onSearchClear() {
    if (!this.data.searchValue) return
    this.setData({ searchValue: '' })
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 0
    })
    this.loadProducts(true)
  },

  onCategoryChange(e) {
    const { id } = e.currentTarget.dataset
    if (!id || id === this.data.activeCategory) return

    this.setData({ activeCategory: id })
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 0
    })
    this.loadProducts(true)
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
