// pages/mall/home.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    searchValue: '',
    // 每日推荐商品
    featuredProduct: null,
    // 分类列表
    categories: [
      { id: 'all', name: '全部', icon: 'apps-o' },
      { id: '手工体验', name: '手工体验', icon: 'gift-o' },
      { id: '非遗摆件', name: '非遗摆件', icon: 'gem-o' },
      { id: '地道风物', name: '地道风物', icon: 'shop-o' },
      { id: '文房四宝', name: '文房雅器', icon: 'edit' }
    ],
    activeCategory: 'all',
    // 非遗工坊直供专区
    workshops: [],
    // 商品列表 - 双列瀑布流
    leftColumn: [],
    rightColumn: [],
    // 加载状态
    loading: true,
    loadingMore: false,
    noMore: false,
    // 分页
    page: 0,
    pageSize: 10
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadFeaturedProduct()
    this.loadWorkshops()
    this.loadProducts(true)
  },

  /**
   * 加载每日推荐商品
   */
  async loadFeaturedProduct() {
    try {
      const res = await db.collection('products')
        .orderBy('sales', 'desc')
        .limit(1)
        .get()
      
      if (res.data.length > 0) {
        this.setData({
          featuredProduct: res.data[0]
        })
      }
    } catch (err) {
      console.error('加载推荐商品失败:', err)
    }
  },

  /**
   * 加载非遗工坊直供专区
   * 根据商品的 origin 和 related_project_name 分组
   */
  async loadWorkshops() {
    try {
      const res = await db.collection('products')
        .orderBy('sales', 'desc')
        .get()
      
      const products = res.data
      
      // 按 origin 分组，创建工坊数据
      const workshopMap = new Map()
      
      products.forEach(product => {
        if (!product.origin) return
        
        // 提取城市名作为工坊标识
        const city = product.origin.split('·')[1] || product.origin
        const workshopKey = city
        
        if (!workshopMap.has(workshopKey)) {
          // 生成工坊名称
          let workshopName = ''
          if (product.related_project_name) {
            workshopName = `${city}${product.related_project_name}工坊`
          } else {
            workshopName = `${city}非遗工坊`
          }
          
          workshopMap.set(workshopKey, {
            id: workshopKey,
            name: workshopName,
            origin: product.origin,
            product: product // 代表作（第一个商品，销量最高）
          })
        }
      })
      
      const workshops = Array.from(workshopMap.values())
      
      this.setData({
        workshops: workshops
      })
    } catch (err) {
      console.error('加载工坊数据失败:', err)
    }
  },

  /**
   * 加载商品列表
   */
  async loadProducts(refresh = false) {
    if (this.data.loadingMore && !refresh) return
    if (this.data.noMore && !refresh) return

    if (refresh) {
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
      const { activeCategory, page, pageSize, searchValue } = this.data
      
      let query = db.collection('products')
      
      // 分类筛选
      if (activeCategory !== 'all') {
        query = query.where({
          category: activeCategory
        })
      }
      
      // 搜索筛选
      if (searchValue) {
        query = query.where({
          title: db.RegExp({
            regexp: searchValue,
            options: 'i'
          })
        })
      }
      
      const res = await query
        .skip(page * pageSize)
        .limit(pageSize)
        .orderBy('sales', 'desc')
        .get()
      
      const products = res.data
      
      if (products.length < pageSize) {
        this.setData({ noMore: true })
      }

      // 瀑布流分配 - 简单的左右交替分配
      const { leftColumn, rightColumn } = this.data
      let left = refresh ? [] : [...leftColumn]
      let right = refresh ? [] : [...rightColumn]
      
      products.forEach((item, index) => {
        // 跳过推荐商品（如果在第一页）
        if (refresh && this.data.featuredProduct && item._id === this.data.featuredProduct._id) {
          return
        }
        
        if ((left.length <= right.length)) {
          left.push(item)
        } else {
          right.push(item)
        }
      })

      this.setData({
        leftColumn: left,
        rightColumn: right,
        page: page + 1,
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

  /**
   * 搜索输入
   */
  onSearchInput(e) {
    this.setData({
      searchValue: e.detail
    })
  },

  /**
   * 搜索确认
   */
  onSearch() {
    this.loadProducts(true)
  },

  /**
   * 清空搜索
   */
  onSearchClear() {
    this.setData({
      searchValue: ''
    })
    this.loadProducts(true)
  },

  /**
   * 切换分类
   */
  onCategoryTap(e) {
    const { id } = e.currentTarget.dataset
    if (id === this.data.activeCategory) return
    
    this.setData({
      activeCategory: id,
      searchValue: ''
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
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.loadProducts(true).then(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    this.loadProducts(false)
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '湘韵遗珍 · 文创好物',
      path: '/pages/mall/home'
    }
  }
})

