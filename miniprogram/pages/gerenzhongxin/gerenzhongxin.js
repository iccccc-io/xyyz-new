// pages/gerenzhongxin/gerenzhongxin.js
const app = getApp()
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 是否已登录
    isLoggedIn: false,
    // 用户信息
    userInfo: {
      nickname: '',
      avatar_url: '',
      is_certified: false,
      certified_title: '',
      stats: {
        following: 0,
        followers: 0,
        likes: 0,
        views: 0
      }
    },
    viewsFormatted: '0',
    // 买家订单统计（状态码与顶层设计一致：10/20/30/40/60）
    orderCounts: {
      pending: 0,    // 10: Pending_Pay
      toShip: 0,     // 20: Pending_Ship
      toReceive: 0,  // 30: Shipped
      completed: 0,  // 40: Completed
      refund: 0      // 60: After_Sale
    },
    // 工坊数据（仅认证传承人可见）
    workshopData: null,
    workshopPendingOrders: 0,
    // 钱包余额预览（元，保留两位小数的字符串）
    walletBalance: null,
    userPosts: [],
    leftPosts: [],
    rightPosts: [],
    activeTab: 0,
    
    // 收藏相关
    collectedPosts: [],
    leftCollectedPosts: [],
    rightCollectedPosts: [],
    collectionsLoading: false,
    collectionsLoaded: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.checkLoginStatus()
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 更新自定义 tabBar 选中状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateActive(4)
    }
    
    // 每次显示页面时检查登录状态（可能从登录页返回）
    this.checkLoginStatus()
    
    // 如果当前在收藏 Tab，刷新收藏列表（可能在详情页取消了收藏）
    if (this.data.activeTab === 1 && this.data.collectionsLoaded) {
      this.setData({ collectionsLoaded: false })
      this.loadUserCollections()
    }
  },

  /**
   * 检查登录状态
   */
  checkLoginStatus() {
    const userInfo = app.globalData.userInfo
    
    if (userInfo) {
      // 已登录
      this.setData({
        isLoggedIn: true,
        userInfo: {
          ...this.data.userInfo,
          ...userInfo,
          stats: userInfo.stats || this.data.userInfo.stats
        },
        viewsFormatted: this.formatNumber(userInfo.stats ? userInfo.stats.views : 0)
      })
      
      // 加载用户相关数据
      this.loadOrderCounts()
      this.loadUserPosts()
      this.loadWalletBalance()

      // 认证传承人：额外加载工坊管理数据
      if (userInfo.is_certified && userInfo.workshop_id) {
        this.loadWorkshopSummary(userInfo.workshop_id)
      }
    } else {
      // 未登录，显示游客蒙版
      this.setData({
        isLoggedIn: false
      })
      
      // 设置回调，登录成功后刷新
      app.userInfoReadyCallback = (userInfo) => {
        this.checkLoginStatus()
      }
    }
  },

  /**
   * 跳转到登录页
   */
  goToLogin() {
    wx.navigateTo({
      url: '/pages/login/login'
    })
  },

  /**
   * 加载订单统计
   */
  /**
   * 加载买家订单统计
   * 状态码遵循顶层设计：10/20/30/40/50/60
   */
  async loadOrderCounts() {
    if (!app.globalData.openid) return

    try {
      const ordersRes = await db.collection('shopping_orders')
        .where({ _openid: app.globalData.openid })
        .field({ status: true })
        .get()

      const orders = ordersRes.data || []

      this.setData({
        orderCounts: {
          pending: orders.filter(o => o.status === 10).length,   // Pending_Pay
          toShip: orders.filter(o => o.status === 20).length,    // Pending_Ship
          toReceive: orders.filter(o => o.status === 30).length, // Shipped
          completed: orders.filter(o => o.status === 40).length, // Completed
          refund: orders.filter(o => o.status === 60).length     // After_Sale
        }
      })
    } catch (err) {
      console.error('加载订单统计失败:', err)
    }
  },

  /**
   * 加载工坊核心数据（仅认证传承人调用）
   * @param {string} workshopId - 工坊ID
   */
  async loadWorkshopSummary(workshopId) {
    try {
      // 工坊基础信息
      const workshopRes = await db.collection('shopping_workshops')
        .doc(workshopId)
        .get()

      if (!workshopRes.data) return

      // 待发货订单数（卖家视角：status=20）
      const pendingRes = await db.collection('shopping_orders')
        .where({
          'product_snapshot.workshop_id': workshopId,
          status: 20
        })
        .count()

      this.setData({
        workshopData: workshopRes.data,
        workshopPendingOrders: pendingRes.total || 0
      })
    } catch (err) {
      console.error('加载工坊数据失败:', err)
    }
  },

  /**
   * 加载用户笔记
   */
  async loadUserPosts() {
    if (!app.globalData.userInfo) return
    
    try {
      const postsRes = await db.collection('community_posts')
        .where({
          _openid: app.globalData.openid
        })
        .orderBy('create_time', 'desc')
        .get()

      const userPosts = postsRes.data || []
      
      const leftPosts = []
      const rightPosts = []
      
      userPosts.forEach((item, index) => {
        if (index % 2 === 0) {
          leftPosts.push(item)
        } else {
          rightPosts.push(item)
        }
      })

      this.setData({
        userPosts,
        leftPosts,
        rightPosts
      })

      console.log('用户笔记:', userPosts)

    } catch (err) {
      console.error('加载用户笔记失败:', err)
    }
  },

  /**
   * 加载用户收藏
   */
  async loadUserCollections() {
    if (!app.globalData.openid) return
    if (this.data.collectionsLoaded) return // 避免重复加载
    
    this.setData({ collectionsLoading: true })
    
    try {
      const _ = db.command
      
      // 1. 查询收藏关系表，获取所有收藏的帖子 ID
      const collectionsRes = await db.collection('community_collections')
        .where({
          _openid: app.globalData.openid
        })
        .orderBy('create_time', 'desc')
        .limit(100)
        .get()

      const collections = collectionsRes.data || []
      
      if (collections.length === 0) {
        this.setData({
          collectedPosts: [],
          leftCollectedPosts: [],
          rightCollectedPosts: [],
          collectionsLoading: false,
          collectionsLoaded: true
        })
        return
      }

      // 2. 获取所有帖子 ID
      const postIds = collections.map(c => c.post_id)
      
      // 3. 批量查询帖子详情
      const postsRes = await db.collection('community_posts')
        .where({
          _id: _.in(postIds)
        })
        .get()

      // 4. 按收藏时间排序（保持原有顺序）
      const postsMap = {}
      postsRes.data.forEach(post => {
        postsMap[post._id] = post
      })
      
      const myOpenid = app.globalData.openid
      const collectedPosts = postIds
        .map(id => postsMap[id])
        .filter(post => {
          if (!post) return false  // 过滤掉已被删除的帖子
          // 过滤掉私密帖子（status=1 的帖子只有作者可见）
          if (post.status === 1 && post._openid !== myOpenid) return false
          return true
        })
      
      // 5. 分配到左右两列
      const leftCollectedPosts = []
      const rightCollectedPosts = []
      
      collectedPosts.forEach((item, index) => {
        if (index % 2 === 0) {
          leftCollectedPosts.push(item)
        } else {
          rightCollectedPosts.push(item)
        }
      })

      this.setData({
        collectedPosts,
        leftCollectedPosts,
        rightCollectedPosts,
        collectionsLoading: false,
        collectionsLoaded: true
      })

      console.log('用户收藏:', collectedPosts)

    } catch (err) {
      console.error('加载用户收藏失败:', err)
      this.setData({ collectionsLoading: false })
    }
  },

  /**
   * 格式化大数字
   */
  formatNumber(num) {
    if (!num) return '0'
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w'
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k'
    }
    return String(num)
  },

  /**
   * Tab 切换
   */
  onTabChange(e) {
    const index = e.detail.index
    this.setData({
      activeTab: index
    })
    
    // 切换到"我的收藏" Tab 时加载收藏数据
    if (index === 1 && !this.data.collectionsLoaded) {
      this.loadUserCollections()
    }
  },

  /**
   * 跳转到帖子详情
   */
  goToPostDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/community/detail?id=${id}`
    })
  },

  /**
   * 跳转到关注列表
   */
  goToFollowing() {
    if (!this.data.isLoggedIn) {
      this.goToLogin()
      return
    }
    wx.navigateTo({
      url: '/pages/user/relations?tab=0'
    })
  },

  /**
   * 跳转到粉丝列表
   */
  goToFollowers() {
    if (!this.data.isLoggedIn) {
      this.goToLogin()
      return
    }
    wx.navigateTo({
      url: '/pages/user/relations?tab=1'
    })
  },

  /**
   * 跳转到订单列表
   */
  goToOrders(e) {
    const status = e.currentTarget.dataset.status
    // status 直接映射到订单状态码：10/20/30/40/60
    const url = status ? `/pages/order/list?status=${status}` : '/pages/order/list'
    wx.navigateTo({ url })
  },

  /**
   * 跳转到全部订单
   */
  goToAllOrders() {
    wx.navigateTo({ url: '/pages/order/list' })
  },

  /**
   * 跳转到收货地址
   */
  goToAddress() {
    wx.navigateTo({ url: '/pages/address/list' })
  },

  /**
   * 加载钱包余额预览（仅展示，不做完整钱包逻辑）
   */
  async loadWalletBalance() {
    const openid = app.globalData.openid
    if (!openid) return
    try {
      const res = await db.collection('shopping_wallets')
        .where({ _openid: openid })
        .field({ balance: true })
        .get()
      if (res.data && res.data.length > 0) {
        const bal = res.data[0].balance || 0
        this.setData({ walletBalance: (bal / 100).toFixed(2) })
      }
    } catch (err) {
      console.warn('加载余额预览失败:', err)
    }
  },

  /**
   * 跳转到钱包页
   */
  goToWallet() {
    if (!this.data.isLoggedIn) { this.goToLogin(); return }
    wx.navigateTo({ url: '/pages/wallet/index' })
  },

  /**
   * 跳转到我的工坊（商品管理）
   */
  goToMyWorkshop() {
    const { userInfo } = this.data
    if (!userInfo.is_certified || !userInfo.workshop_id) {
      wx.showToast({ title: '工坊信息异常', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/workshop/index?id=${userInfo.workshop_id}` })
  },

  /**
   * 跳转到发布商品页
   */
  goToPublish() {
    if (!this.data.isLoggedIn) { this.goToLogin(); return }
    wx.navigateTo({ url: '/pages/product/publish' })
  },

  /**
   * 跳转到卖家待发货订单（第三阶段实现，暂提示）
   */
  goToSellerOrders() {
    wx.navigateTo({ url: '/pages/order/seller-list' })
  },

  goToAftersaleCenter() {
    wx.navigateTo({ url: '/pages/aftersale/seller-list' })
  },

  /**
   * 跳转到工坊财务（第二阶段实现，暂提示）
   */
  goToWorkshopFinance() {
    wx.showToast({ title: '财务中心（第二阶段开发中）', icon: 'none' })
  },

  /**
   * 跳转到认证页面或工坊
   */
  goToCertify() {
    // 检查登录状态
    if (!this.data.isLoggedIn) {
      this.goToLogin()
      return
    }
    
    // 根据认证状态跳转到不同页面
    if (this.data.userInfo.is_certified) {
      // 已认证，跳转到工坊页面
      if (this.data.userInfo.workshop_id) {
        wx.navigateTo({
          url: `/pages/workshop/index?id=${this.data.userInfo.workshop_id}`
        })
      } else {
        wx.showToast({
          title: '工坊信息异常',
          icon: 'none'
        })
      }
    } else {
      // 未认证，跳转到认证申请页面
      wx.navigateTo({
        url: '/pages/certification/apply'
      })
    }
  },

  /**
   * 跳转到非遗足迹
   */
  goToFootprint() {
    wx.showToast({
      title: '足迹功能开发中',
      icon: 'none'
    })
  },

  /**
   * 联系客服
   */
  contactService() {
    wx.showToast({
      title: '客服功能开发中',
      icon: 'none'
    })
  },

  /**
   * 退出登录
   */
  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      confirmColor: '#8B2E2A',
      success: (res) => {
        if (res.confirm) {
          app.logout()
          this.setData({
            isLoggedIn: false,
            userInfo: {
              nickname: '',
              avatar_url: '',
              is_certified: false,
              certified_title: '',
              stats: {
                following: 0,
                followers: 0,
                likes: 0,
                views: 0
              }
            },
            orderCounts: {
              pending: 0,
              toShip: 0,
              toReceive: 0,
              completed: 0,
              refund: 0
            },
            workshopData: null,
            workshopPendingOrders: 0,
            walletBalance: null,
            userPosts: [],
            leftPosts: [],
            rightPosts: [],
            collectedPosts: [],
            leftCollectedPosts: [],
            rightCollectedPosts: [],
            collectionsLoaded: false
          })
        }
      }
    })
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.checkLoginStatus()
    wx.stopPullDownRefresh()
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})
