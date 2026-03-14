// pages/mall/detail.js
const app = getApp()
const db = wx.cloud.database()

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
    safeAreaBottom: 0
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
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

    // 获取安全区域
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      safeAreaBottom: systemInfo.safeArea ? (systemInfo.screenHeight - systemInfo.safeArea.bottom) : 0
    })
  },

  /**
   * 加载商品详情
   */
  async loadProductDetail(id) {
    try {
      const res = await db.collection('shopping_products').doc(id).get()
      
      if (res.data) {
        const product = res.data

        if (!product.detail_imgs || product.detail_imgs.length === 0) {
          product.detail_imgs = [product.cover_img]
        }

        // 价格格式化（分→元显示）
        product.priceDisplay = formatPrice(product.price)
        product.originalPriceDisplay = product.original_price ? formatPrice(product.original_price) : ''
        // 顶层设计要求：商品页强制展示所属非遗项目，字段已有 related_project_name / related_project_id

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

        this.setData({
          product: product,
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

  /**
   * 轮播图切换
   */
  onSwiperChange(e) {
    this.setData({
      currentImageIndex: e.detail.current
    })
  },

  /**
   * 预览图片
   */
  previewImage(e) {
    const { product, currentImageIndex } = this.data
    wx.previewImage({
      urls: product.detail_imgs,
      current: product.detail_imgs[currentImageIndex]
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

