// pages/mall/detail.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    product: null,
    loading: true,
    currentImageIndex: 0,
    // 购买数量
    quantity: 1,
    // 是否已收藏
    isFavorite: false,
    // 底部安全区高度
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
      const res = await db.collection('products').doc(id).get()
      
      if (res.data) {
        // 处理图片数组
        const product = res.data
        if (!product.detail_imgs || product.detail_imgs.length === 0) {
          product.detail_imgs = [product.cover_img]
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
   * 收藏/取消收藏
   */
  toggleFavorite() {
    this.setData({
      isFavorite: !this.data.isFavorite
    })
    wx.showToast({
      title: this.data.isFavorite ? '已收藏' : '已取消收藏',
      icon: 'none'
    })
  },

  /**
   * 加入购物车
   */
  addToCart() {
    const { product, quantity } = this.data
    
    // 获取本地购物车
    let cart = wx.getStorageSync('cart') || []
    
    // 检查是否已在购物车中
    const existIndex = cart.findIndex(item => item.productId === product._id)
    
    if (existIndex > -1) {
      // 更新数量
      cart[existIndex].quantity += quantity
    } else {
      // 添加新商品
      cart.push({
        productId: product._id,
        title: product.title,
        cover_img: product.cover_img,
        price: product.price,
        quantity: quantity,
        origin: product.origin
      })
    }
    
    wx.setStorageSync('cart', cart)
    
    wx.showToast({
      title: '已加入购物车',
      icon: 'success'
    })
  },

  /**
   * 立即购买
   */
  buyNow() {
    const { product, quantity } = this.data
    
    // 检查库存
    if (product.stock < quantity) {
      wx.showToast({
        title: '库存不足',
        icon: 'none'
      })
      return
    }
    
    // 模拟下单（实际项目中应跳转到订单确认页）
    wx.showModal({
      title: '确认下单',
      content: `商品：${product.title}\n数量：${quantity}\n总价：¥${(product.price * quantity).toFixed(2)}`,
      confirmText: '确认',
      confirmColor: '#8B2E2A',
      success: (res) => {
        if (res.confirm) {
          this.createOrder()
        }
      }
    })
  },

  /**
   * 创建订单
   */
  async createOrder() {
    const { product, quantity } = this.data
    
    wx.showLoading({ title: '下单中...' })
    
    try {
      await db.collection('orders').add({
        data: {
          status: 0, // 待付款
          total_price: product.price * quantity,
          product_snapshot: {
            product_id: product._id,
            title: product.title,
            cover_img: product.cover_img,
            price: product.price,
            count: quantity
          },
          create_time: db.serverDate()
        }
      })
      
      wx.hideLoading()
      wx.showToast({
        title: '下单成功',
        icon: 'success'
      })
      
      // 延迟返回
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    } catch (err) {
      wx.hideLoading()
      console.error('创建订单失败:', err)
      wx.showToast({
        title: '下单失败',
        icon: 'none'
      })
    }
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

