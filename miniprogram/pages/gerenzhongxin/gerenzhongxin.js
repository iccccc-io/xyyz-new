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
    orderCounts: {
      pending: 0,
      toShip: 0,
      toReceive: 0,
      completed: 0,
      refund: 0
    },
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
  async loadOrderCounts() {
    if (!app.globalData.openid) return
    
    try {
      const ordersRes = await db.collection('orders')
        .where({
          _openid: app.globalData.openid
        })
        .get()

      const orders = ordersRes.data || []
      
      const orderCounts = {
        pending: orders.filter(o => o.status === 0).length,
        toShip: orders.filter(o => o.status === 1).length,
        toReceive: orders.filter(o => o.status === 2).length,
        completed: orders.filter(o => o.status === 3).length,
        refund: orders.filter(o => o.status === 4).length
      }

      this.setData({ orderCounts })
      console.log('订单统计:', orderCounts)

    } catch (err) {
      console.error('加载订单统计失败:', err)
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
    wx.showToast({
      title: '订单功能开发中',
      icon: 'none'
    })
  },

  /**
   * 跳转到全部订单
   */
  goToAllOrders() {
    wx.showToast({
      title: '订单功能开发中',
      icon: 'none'
    })
  },

  /**
   * 跳转到收货地址
   */
  goToAddress() {
    wx.showToast({
      title: '地址管理开发中',
      icon: 'none'
    })
  },

  /**
   * 跳转到认证页面
   */
  goToCertify() {
    wx.showToast({
      title: '认证功能开发中',
      icon: 'none'
    })
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
