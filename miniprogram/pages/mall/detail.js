const app = getApp()
const db = wx.cloud.database()
const { createProductSelectionView, getSelectedOrDefaultSku } = require('../../common/mall-sku')
const { decorateReview, formatScoreValue } = require('../../common/review')

const LOGISTICS_CARRIER_TEXT = {
  sf_jd: '顺丰/京东',
  standard: '三通一达',
  post: '中国邮政',
  heavy_cargo: '大件物流',
  others: '视情况而定',
  pickup: '同城自提'
}

const LOGISTICS_HANDLING_TIME_TEXT = {
  '24h': '24小时',
  '48h': '48小时',
  '3d': '3天',
  '7d': '7天',
  custom_15d: '接单定制(约15天)'
}

function uniqueImages(list) {
  const seen = new Set()
  return (list || []).filter((src) => {
    if (!src || seen.has(src)) return false
    seen.add(src)
    return true
  })
}

function normalizeLogistics(logistics, originDisplay) {
  const method = logistics && logistics.method ? logistics.method : 'express'
  const postage = logistics && logistics.postage ? logistics.postage : 'free'
  const carrier = logistics && logistics.carrier ? logistics.carrier : (method === 'pickup' ? 'pickup' : 'sf_jd')
  const handlingTime = logistics && logistics.handling_time ? logistics.handling_time : '48h'
  const shipFrom = (logistics && logistics.ship_from ? logistics.ship_from : originDisplay || '湖南·长沙').trim()
  const carrierDisplay = LOGISTICS_CARRIER_TEXT[carrier] || '视情况而定'
  const handlingTimeDisplay = LOGISTICS_HANDLING_TIME_TEXT[handlingTime] || '48小时'
  const shippingPromiseText = handlingTime === 'custom_15d'
    ? `${handlingTimeDisplay}发货`
    : `${handlingTimeDisplay}内发货`

  let summaryText = `发货地：${shipFrom} | ${postage === 'free' ? '快递包邮' : '邮费到付'} | 预计使用：${carrierDisplay}`
  if (method === 'pickup') {
    summaryText = handlingTime === 'custom_15d'
      ? `发货地：${shipFrom} | 同城自提 | ${handlingTimeDisplay}可提货`
      : `发货地：${shipFrom} | 同城自提 | ${handlingTimeDisplay}内可提货`
  } else if (method === 'heavy_cargo') {
    summaryText = `发货地：${shipFrom} | ${postage === 'free' ? '专线包邮' : '运费到付'} | 预计使用：${carrierDisplay}`
  }

  return {
    method,
    postage,
    carrier,
    handling_time: handlingTime,
    ship_from: shipFrom,
    carrierDisplay,
    handlingTimeDisplay,
    shippingPromiseText,
    summaryText
  }
}

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync()
  const statusBarHeight = systemInfo.statusBarHeight || 20
  const safeAreaBottom = systemInfo.safeArea ? (systemInfo.screenHeight - systemInfo.safeArea.bottom) : 0
  const menuRect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null

  const backButtonTop = menuRect && menuRect.top ? menuRect.top : statusBarHeight + 6
  const backButtonHeight = menuRect && menuRect.height ? menuRect.height : 32
  const backButtonWidth = menuRect && menuRect.height ? Math.round(menuRect.height * 1.7) : 56
  const heroCanvasTop = menuRect && menuRect.bottom ? Math.round(menuRect.bottom + 40) : statusBarHeight + 84

  return {
    statusBarHeight,
    safeAreaBottom,
    backButtonTop,
    backButtonHeight,
    backButtonWidth,
    heroCanvasTop
  }
}

function parseProductIdFromOptions(options = {}) {
  if (options.id) return options.id
  if (!options.scene) return ''
  const scene = decodeURIComponent(options.scene)
  return scene
    .split('&')
    .map((item) => item.split('='))
    .find((pair) => pair[0] === 'id')?.[1] || ''
}

function normalizeProduct(product, selectedSkuId = '') {
  const selection = createProductSelectionView(product, selectedSkuId)
  const detailImages = uniqueImages(selection.detail_imgs && selection.detail_imgs.length
    ? selection.detail_imgs
    : selection.displayHeroImages)
  const tags = Array.isArray(selection.tags) ? selection.tags.filter(Boolean) : []
  const displayTags = (tags.length ? tags : [selection.category].filter(Boolean)).slice(0, 3)
  const introDisplay = (selection.intro || '暂无简介').trim()
  const originDisplay = (selection.origin || '湖南').trim()
  const salesDisplay = Number(selection.sales) || 0
  const logistics = normalizeLogistics(selection.logistics, originDisplay)

  let workshopInfo = null
  let workshopCardTag = ''
  if (selection.workshop_info) {
    const name = selection.workshop_info.name || '非遗工坊'
    workshopInfo = {
      ...selection.workshop_info,
      name,
      logoDisplay: selection.workshop_info.logo || '',
      initial: String(name).trim().charAt(0) || '匠'
    }
    workshopCardTag = selection.workshop_info.ich_category || selection.related_project_name || '非遗工坊'
  }

  return {
    ...selection,
    heroImages: selection.displayHeroImages,
    detailImages,
    displayTags,
    introDisplay,
    originDisplay,
    salesDisplay,
    logistics,
    workshop_info: workshopInfo,
    workshopCardTag
  }
}

Page({
  data: {
    product: null,
    loading: true,
    reviewLoading: false,
    reviewSummary: {
      rating_avg: 0,
      review_count: 0,
      displayScore: '暂无评分'
    },
    reviewPreviewList: [],
    currentImageIndex: 0,
    isFavorite: false,
    isUnavailable: false,
    safeAreaBottom: 0,
    statusBarHeight: 20,
    backButtonTop: 26,
    backButtonHeight: 32,
    backButtonWidth: 56,
    heroCanvasTop: 100,
    showSkuPopup: false,
    selectedSkuId: '',
    quantity: 1
  },

  onLoad(options) {
    this.setData(getNavMetrics())

    const id = parseProductIdFromOptions(options)
    if (id) {
      this.loadProductDetail(id)
    } else {
      wx.showToast({
        title: '商品不存在',
        icon: 'none'
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    }
  },

  async loadProductDetail(id) {
    try {
      const res = await db.collection('shopping_products').doc(id).get()
      if (!res.data) {
        throw new Error('商品不存在')
      }

      const product = {
        ...res.data,
        detail_imgs: res.data.detail_imgs && res.data.detail_imgs.length ? res.data.detail_imgs : [res.data.cover_img]
      }

      if (product.workshop_id) {
        try {
          const workshopRes = await db.collection('shopping_workshops').doc(product.workshop_id).get()
          product.workshop_info = workshopRes.data
        } catch (err) {
          console.log('工坊信息加载失败:', err)
        }
      }

        this._rawProduct = product
        this.applyProductView('')
        this.loadReviewSummary(id)

        wx.cloud.callFunction({
          name: 'report_product_view',
        data: { product_id: id }
      }).catch(() => {})

      wx.setNavigationBarTitle({
        title: product.title
      })
    } catch (err) {
      console.error('加载商品详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  applyProductView(selectedSkuId, nextData = {}) {
    if (!this._rawProduct) return

    const product = normalizeProduct(this._rawProduct, selectedSkuId)
    const isUnavailable = product.status !== 1 || product.is_on_sale === false || !product.total_stock
    const maxStock = product.selectedSku ? product.selectedSku.stock : product.total_stock
    const quantity = Math.max(1, Math.min(nextData.quantity || this.data.quantity || 1, Math.max(maxStock, 1)))
    const currentImageIndex = Math.min(this.data.currentImageIndex || 0, Math.max(product.heroImages.length - 1, 0))

    this.setData({
      product,
      selectedSkuId: selectedSkuId || '',
      currentImageIndex,
      quantity,
      isUnavailable,
      loading: false,
      ...nextData
    })
  },

  async loadReviewSummary(productId) {
    if (!productId) return

    this.setData({ reviewLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_review',
        data: {
          action: 'list_product',
          product_id: productId,
          page: 1,
          page_size: 2,
          filter_type: 'all'
        }
      })

      const result = res.result
      if (result && result.success) {
        const summary = result.summary || {}
        this.setData({
          reviewSummary: {
            ...summary,
            displayScore: formatScoreValue(summary.rating_avg, summary.review_count)
          },
          reviewPreviewList: (result.list || []).map((item) => decorateReview(item))
        })
      } else {
        this.setData({
          reviewSummary: {
            rating_avg: 0,
            review_count: 0,
            displayScore: '暂无评分'
          },
          reviewPreviewList: []
        })
      }
    } catch (err) {
      console.warn('[mall/detail] loadReviewSummary failed:', err)
      this.setData({
        reviewSummary: {
          rating_avg: 0,
          review_count: 0,
          displayScore: '暂无评分'
        },
        reviewPreviewList: []
      })
    } finally {
      this.setData({ reviewLoading: false })
    }
  },

  showPrevHeroImage() {
    const { product, currentImageIndex } = this.data
    if (!product || !product.heroImages || product.heroImages.length <= 1) return
    const total = product.heroImages.length
    this.setData({
      currentImageIndex: (currentImageIndex - 1 + total) % total
    })
  },

  showNextHeroImage() {
    const { product, currentImageIndex } = this.data
    if (!product || !product.heroImages || product.heroImages.length <= 1) return
    const total = product.heroImages.length
    this.setData({
      currentImageIndex: (currentImageIndex + 1) % total
    })
  },

  previewImage(e) {
    const { product, currentImageIndex } = this.data
    const { index, kind } = e.currentTarget.dataset
    const imageList = kind === 'detail' ? product.detailImages : product.heroImages
    const currentIndex = Number.isFinite(Number(index)) ? Number(index) : currentImageIndex

    wx.previewImage({
      urls: imageList,
      current: imageList[currentIndex]
    })
  },

  previewReviewImages(e) {
    const urls = Array.isArray(e.currentTarget.dataset.urls) ? e.currentTarget.dataset.urls : []
    const index = Number(e.currentTarget.dataset.index || 0)
    if (!urls.length) return

    wx.previewImage({
      urls,
      current: urls[index] || urls[0]
    })
  },

  getEffectiveSku() {
    return getSelectedOrDefaultSku(this._rawProduct, this.data.selectedSkuId)
  },

  decreaseQuantity() {
    if (this.data.quantity > 1) {
      this.setData({
        quantity: this.data.quantity - 1
      })
    }
  },

  increaseQuantity() {
    const activeSku = this.getEffectiveSku()
    const maxStock = activeSku ? activeSku.stock : 0
    if (this.data.quantity < maxStock) {
      this.setData({
        quantity: this.data.quantity + 1
      })
    } else {
      wx.showToast({
        title: '已达库存上限',
        icon: 'none'
      })
    }
  },

  ensureProductAvailable() {
    const { product, isUnavailable } = this.data
    if (!product || isUnavailable || product.is_on_sale === false || product.status !== 1) {
      wx.showToast({ title: '商品已下架', icon: 'none' })
      return false
    }
    if (!product.total_stock) {
      wx.showToast({ title: '商品已售罄', icon: 'none' })
      return false
    }
    return true
  },

  openSkuPopup() {
    if (!app.checkLogin()) {
      app.requireLogin()
      return
    }
    if (!this.ensureProductAvailable()) return

    const activeSku = this.getEffectiveSku()
    if (!activeSku) {
      wx.showToast({ title: '该商品暂无可选款式', icon: 'none' })
      return
    }

    this.applyProductView(activeSku.sku_id, {
      showSkuPopup: true,
      quantity: Math.max(1, Math.min(this.data.quantity || 1, Math.max(activeSku.stock, 1)))
    })
  },

  closeSkuPopup() {
    this.setData({ showSkuPopup: false })
  },

  selectSku(e) {
    const skuId = e.currentTarget.dataset.id
    if (!skuId) return

    const sku = getSelectedOrDefaultSku(this._rawProduct, skuId)
    if (!sku) return

    this.applyProductView(skuId, {
      quantity: Math.max(1, Math.min(this.data.quantity || 1, Math.max(sku.stock, 1)))
    })
  },

  confirmSkuBuy() {
    if (!app.checkLogin()) {
      app.requireLogin()
      return
    }

    if (!this.ensureProductAvailable()) return

    const sku = getSelectedOrDefaultSku(this._rawProduct, this.data.selectedSkuId)
    if (!sku) {
      wx.showToast({ title: '请选择款式', icon: 'none' })
      return
    }
    if (sku.stock < this.data.quantity) {
      wx.showToast({ title: '该款式库存不足', icon: 'none' })
      return
    }

    wx.navigateTo({
      url: `/pages/mall/checkout?productId=${this.data.product._id}&skuId=${sku.sku_id}&quantity=${this.data.quantity}`
    })
  },

  goToWorkshop() {
    const { product } = this.data
    if (product && product.workshop_id) {
      wx.navigateTo({
        url: `/pages/workshop/index?id=${product.workshop_id}`
      })
    }
  },

  goToProductReviews() {
    const { product } = this.data
    if (!product || !product._id) return
    wx.navigateTo({
      url: `/pages/review/product-list?productId=${product._id}`
    })
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }

    wx.switchTab({
      url: '/pages/mall/home'
    })
  },

  goToProject() {
    const { product } = this.data
    if (product && product.related_project_id) {
      wx.navigateTo({
        url: `/pages/resource/project-detail?id=${product.related_project_id}`
      })
    } else {
      wx.showToast({
        title: '暂无关联项目',
        icon: 'none'
      })
    }
  },

  toggleFavorite() {
    if (!app.checkLogin()) {
      app.requireLogin()
      return
    }

    this.setData({
      isFavorite: !this.data.isFavorite
    })
    wx.showToast({
      title: this.data.isFavorite ? '已收藏' : '已取消收藏',
      icon: 'none'
    })
  },

  buyNow() {
    this.openSkuPopup()
  },

  onShareAppMessage() {
    const { product } = this.data
    return {
      title: product ? product.title : '湘韵遗珍 · 文创好物',
      path: `/pages/mall/detail?id=${product ? product._id : ''}`,
      imageUrl: product ? product.cover_img : ''
    }
  }
})
