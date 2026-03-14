// pages/mall/category.js
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
    // 非遗官方分类列表
    categories: [
      { id: 'all', name: '全部' },
      { id: '民间文学', name: '民间文学' },
      { id: '传统音乐', name: '传统音乐' },
      { id: '传统舞蹈', name: '传统舞蹈' },
      { id: '传统戏剧', name: '传统戏剧' },
      { id: '曲艺', name: '曲艺' },
      { id: '传统体育', name: '传统体育' },
      { id: '传统美术', name: '传统美术' },
      { id: '传统技艺', name: '传统技艺' },
      { id: '传统医药', name: '传统医药' },
      { id: '民俗', name: '民俗' }
    ],
    activeIndex: 0,
    activeCategory: 'all',
    // 商品列表
    products: [],
    // 加载状态
    loading: true,
    // 分页
    page: 0,
    pageSize: 20,
    noMore: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadProducts(true)
  },

  /**
   * 加载商品列表
   */
  async loadProducts(refresh = false) {
    if (refresh) {
      this.setData({
        products: [],
        page: 0,
        noMore: false,
        loading: true
      })
    }

    try {
      const { activeCategory, page, pageSize } = this.data
      
      const _ = db.command
      let whereCondition = { status: 1, stock: _.gt(0) }

      if (activeCategory !== 'all') {
        whereCondition.category = activeCategory
      }

      let query = db.collection('shopping_products').where(whereCondition)

      const res = await query
        .skip(page * pageSize)
        .limit(pageSize)
        .orderBy('sales', 'desc')
        .get()

      const newProducts = res.data.map(item => ({
        ...item,
        priceDisplay: formatPrice(item.price),
        originalPriceDisplay: item.original_price ? formatPrice(item.original_price) : ''
      }))

      if (newProducts.length < pageSize) {
        this.setData({ noMore: true })
      }

      this.setData({
        products: refresh ? newProducts : [...this.data.products, ...newProducts],
        page: page + 1,
        loading: false
      })
    } catch (err) {
      console.error('加载商品列表失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 切换分类
   */
  onCategoryChange(e) {
    const index = e.detail
    const category = this.data.categories[index]
    
    this.setData({
      activeIndex: index,
      activeCategory: category.id
    })
    
    this.loadProducts(true)
  },

  /**
   * 跳转商品详情
   */
  goToDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/mall/detail?id=${id}`
    })
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    if (!this.data.noMore && !this.data.loading) {
      this.loadProducts(false)
    }
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '湘韵遗珍 · 非遗分类',
      path: '/pages/mall/category'
    }
  }
})

