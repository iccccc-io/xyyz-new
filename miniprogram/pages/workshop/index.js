// pages/workshop/index.js
const app = getApp()
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    statusBarHeight: 20,
    workshopId: '', // 工坊ID
    workshopInfo: null, // 工坊信息
    products: [], // 商品列表
    isOwner: false, // 是否是主理人
    loading: true
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20
    })

    // 获取工坊ID
    if (options.id) {
      this.setData({
        workshopId: options.id
      })
      this.loadWorkshopData()
    } else {
      // 如果没有传ID，尝试从用户信息中获取
      this.loadUserWorkshop()
    }
  },

  /**
   * 加载当前用户的工坊
   */
  async loadUserWorkshop() {
    try {
      const userInfo = app.globalData.userInfo
      if (userInfo && userInfo.workshop_id) {
        this.setData({
          workshopId: userInfo.workshop_id
        })
        this.loadWorkshopData()
      } else {
        this.setData({
          loading: false
        })
        wx.showModal({
          title: '提示',
          content: '您还没有创建工坊',
          confirmText: '去认证',
          success: (res) => {
            if (res.confirm) {
              wx.redirectTo({
                url: '/pages/certification/apply'
              })
            } else {
              wx.navigateBack()
            }
          }
        })
      }
    } catch (err) {
      console.error('加载用户工坊失败:', err)
      this.setData({
        loading: false
      })
    }
  },

  /**
   * 加载工坊数据
   */
  async loadWorkshopData() {
    try {
      this.setData({
        loading: true
      })

      // 查询工坊信息
      const workshopRes = await db.collection('shopping_workshops')
        .doc(this.data.workshopId)
        .get()

      if (!workshopRes.data) {
        this.setData({
          loading: false,
          workshopInfo: null
        })
        return
      }

      const workshopInfo = workshopRes.data

      // 判断是否是主理人
      const isOwner = app.globalData.openid && app.globalData.openid === workshopInfo.owner_id
      
      // 格式化评分显示
      if (workshopInfo.rating) {
        workshopInfo.rating = Number(workshopInfo.rating).toFixed(1)
      }

      this.setData({
        workshopInfo,
        isOwner
      })

      // 加载商品列表
      this.loadProducts()

    } catch (err) {
      console.error('加载工坊数据失败:', err)
      this.setData({
        loading: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 加载商品列表
   */
  async loadProducts() {
    try {
      // 查询该工坊下的所有商品
      const productRes = await db.collection('shopping_products')
        .where({
          workshop_id: this.data.workshopId,
          status: 1 // 1表示已上架
        })
        .orderBy('create_time', 'desc')
        .get()

      this.setData({
        products: productRes.data || [],
        loading: false
      })

    } catch (err) {
      console.error('加载商品列表失败:', err)
      this.setData({
        loading: false
      })
    }
  },

  /**
   * 跳转到商品详情
   */
  navigateToProductDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/mall/detail?id=${id}`
    })
  },

  /**
   * 跳转到发布商品页面
   */
  navigateToPublish() {
    // 确认是否是主理人
    if (!this.data.isOwner) {
      wx.showToast({
        title: '仅主理人可发布商品',
        icon: 'none'
      })
      return
    }
    
    wx.navigateTo({
      url: '/pages/product/publish'
    })
  },

  /**
   * 返回上一页
   */
  goBack() {
    wx.navigateBack()
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 如果已经加载过工坊，刷新数据
    if (this.data.workshopId && this.data.workshopInfo) {
      this.loadWorkshopData()
    }
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    if (this.data.workshopId) {
      this.loadWorkshopData().then(() => {
        wx.stopPullDownRefresh()
      })
    } else {
      wx.stopPullDownRefresh()
    }
  }
})

