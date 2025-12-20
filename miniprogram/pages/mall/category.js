// pages/mall/category.js
const db = wx.cloud.database()

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
      
      let query = db.collection('products')
      
      // 分类筛选（按官方非遗分类）
      if (activeCategory !== 'all') {
        query = query.where({
          category: activeCategory
        })
      }
      
      const res = await query
        .skip(page * pageSize)
        .limit(pageSize)
        .orderBy('sales', 'desc')
        .get()
      
      const newProducts = res.data
      
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

