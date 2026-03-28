// pages/mall/detail.js
const app = getApp()
const db = wx.cloud.database()

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

/**
 * 将价格（分）格式化为可读的元字符串
 * @param {number} fen - 价格（单位：分）
 * @returns {string}
 */
function formatPrice(fen) {
  if (!fen && fen !== 0) return '0.00'
  const yuan = fen / 100
  if (yuan >= 100000000) return (yuan / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
  if (yuan >= 10000) return (yuan / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return yuan.toFixed(2).replace(/\.?0+$/, '') || '0'
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

  let summaryText = `发货：${shipFrom} | ${postage === 'free' ? '快递包邮' : '邮费到付'} | 预计使用：${carrierDisplay}`
  if (method === 'pickup') {
    summaryText = handlingTime === 'custom_15d'
      ? `发货：${shipFrom} | 同城自提 | ${handlingTimeDisplay}可提货`
      : `发货：${shipFrom} | 同城自提 | ${handlingTimeDisplay}内可提货`
  } else if (method === 'heavy_cargo') {
    summaryText = `发货：${shipFrom} | ${postage === 'free' ? '专线包邮' : '运费到付'} | 预计使用：${carrierDisplay}`
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

function normalizeProduct(product) {
  const heroImages = uniqueImages([product.cover_img, ...(product.detail_imgs || [])])
  const detailImages = uniqueImages(product.detail_imgs && product.detail_imgs.length ? product.detail_imgs : heroImages)
  const tags = Array.isArray(product.tags) ? product.tags.filter(Boolean) : []
  const displayTags = (tags.length ? tags : [product.category].filter(Boolean)).slice(0, 3)
  const introDisplay = (product.intro || '暂无简介').trim()
  const originDisplay = (product.origin || '湖南').trim()
  const salesDisplay = Number(product.sales) || 0
  const originalPriceDisplay = product.original_price && product.original_price > product.price
    ? formatPrice(product.original_price)
    : ''
  const logistics = normalizeLogistics(product.logistics, originDisplay)

  let workshopInfo = null
  let workshopCardTag = ''
  if (product.workshop_info) {
    const name = product.workshop_info.name || '非遗工坊'
    workshopInfo = {
      ...product.workshop_info,
      name,
      logoDisplay: product.workshop_info.logo || '',
      initial: String(name).trim().charAt(0) || '匠'
    }
    workshopCardTag = product.workshop_info.ich_category || product.related_project_name || '非遗工坊'
  }

  return {
    ...product,
    heroImages,
    detailImages,
    displayTags,
    introDisplay,
    originDisplay,
    salesDisplay,
    originalPriceDisplay,
    logistics,
    workshop_info: workshopInfo,
    workshopCardTag
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

Page({
  /**
   * 页面的初始数据
   */
  data: {
    product: null,
    loading: true,
    currentImageIndex: 0,
    quantity: 1,
    isFavorite: false,
    safeAreaBottom: 0,
    statusBarHeight: 20,
    backButtonTop: 26,
    backButtonHeight: 32,
    backButtonWidth: 56,
    heroCanvasTop: 100
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.setData(getNavMetrics())

    const { id } = options
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

  /**
   * 加载商品详情
   */
  async loadProductDetail(id) {
    try {
      const res = await db.collection('shopping_products').doc(id).get()
      
      if (res.data) {
        const product = {
          ...res.data,
          detail_imgs: res.data.detail_imgs && res.data.detail_imgs.length ? res.data.detail_imgs : [res.data.cover_img],
          priceDisplay: formatPrice(res.data.price)
        }

        // 查询工坊信息（卖家身份展示）
        if (product.workshop_id) {
          try {
            const workshopRes = await db.collection('shopping_workshops')
              .doc(product.workshop_id)
              .get()
            product.workshop_info = workshopRes.data
          } catch (err) {
            console.log('工坊信息加载失败:', err)
          }
        }

        const normalizedProduct = normalizeProduct(product)

        this.setData({
          product: normalizedProduct,
          currentImageIndex: 0,
          quantity: 1,
          loading: false
        })

        // 设置页面标题
        wx.setNavigationBarTitle({
          title: product.title
        })
      }
    } catch (err) {
      console.error('加载商品详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
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

  /**
   * 预览图片
   */
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

  /**
   * 数量减少
   */
  decreaseQuantity() {
    if (this.data.quantity > 1) {
      this.setData({
        quantity: this.data.quantity - 1
      })
    }
  },

  /**
   * 数量增加
   */
  increaseQuantity() {
    const { quantity, product } = this.data
    if (quantity < product.stock) {
      this.setData({
        quantity: quantity + 1
      })
    } else {
      wx.showToast({
        title: '已达库存上限',
        icon: 'none'
      })
    }
  },

  /**
   * 跳转到工坊主页
   */
  goToWorkshop() {
    const { product } = this.data
    if (product && product.workshop_id) {
      wx.navigateTo({
        url: `/pages/workshop/index?id=${product.workshop_id}`
      })
    }
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

  /**
   * 跳转到关联的非遗项目
   */
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

  /**
   * 收藏/取消收藏（需要登录）
   */
  toggleFavorite() {
    // 检查登录状态
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

  /**
   * 加入购物车（需要登录）
   * 购物车使用本地存储，价格以分存储
   */
  addToCart() {
    if (!app.checkLogin()) {
      app.requireLogin()
      return
    }

    const { product, quantity } = this.data
    let cart = wx.getStorageSync('cart') || []
    const existIndex = cart.findIndex(item => item.productId === product._id)

    if (existIndex > -1) {
      cart[existIndex].quantity += quantity
    } else {
      cart.push({
        productId: product._id,
        title: product.title,
        cover_img: product.cover_img,
        price: product.price,           // 分（整数）
        priceDisplay: product.priceDisplay,
        quantity: quantity,
        origin: product.origin,
        related_project_name: product.related_project_name || ''
      })
    }

    wx.setStorageSync('cart', cart)
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },

  /**
   * 立即购买：跳转到下单确认页（含地址选择和支付键盘）
   */
  buyNow() {
    if (!app.checkLogin()) {
      app.requireLogin()
      return
    }

    const { product, quantity } = this.data

    if (product.stock < quantity) {
      wx.showToast({ title: '库存不足', icon: 'none' })
      return
    }

    wx.navigateTo({
      url: `/pages/mall/checkout?productId=${product._id}&quantity=${quantity}`
    })
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    const { product } = this.data
    return {
      title: product ? product.title : '湘韵遗珍 · 文创好物',
      path: `/pages/mall/detail?id=${product ? product._id : ''}`,
      imageUrl: product ? product.cover_img : ''
    }
  }
})

