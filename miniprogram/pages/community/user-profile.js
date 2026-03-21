// pages/community/user-profile.js
// 沉浸式个人主页 - 公共视图

const app = getApp()
const db = wx.cloud.database()
const _ = db.command

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 页面状态
    pageLoading: true,
    statusBarHeight: 20,
    navSolid: false,

    // 用户信息
    userId: '',        // 主页主人的 _id 或 openid
    userOpenid: '',    // 主页主人的 openid
    userInfo: {
      nickname: '',
      avatar_url: '',
      bio: '',
      is_certified: false,
      certified_title: '',
      stats: {
        following: 0,
        followers: 0,
        likes: 0
      }
    },
    backdropImage: '',  // 背景图（最新笔记首图）

    // 当前用户状态
    isSelf: false,      // 是否是自己的主页
    isFollowing: false, // 是否已关注
    isMutual: false,    // 是否互相关注

    // Tab 相关
    activeTab: 0,

    // 笔记数据
    posts: [],
    leftPosts: [],
    rightPosts: [],
    postsLoading: false,
    noMorePosts: false,

    // 收藏数据
    collections: [],
    leftCollections: [],
    rightCollections: [],
    collectionsLoading: false,
    collectionsVisible: false,  // 收藏是否可见
    collectionsLoaded: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    console.log('User Profile onLoad:', options)

    // 获取状态栏高度
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20
    })

    // 获取目标用户ID
    const userId = options.userId || options.id
    if (!userId) {
      wx.showToast({
        title: '用户不存在',
        icon: 'none'
      })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    this.setData({ userId })
    this.initPage()
  },

  /**
   * 初始化页面
   */
  async initPage() {
    try {
      // 1. 获取目标用户信息
      await this.loadUserInfo()

      // 2. 检查是否是自己
      this.checkIsSelf()

      // 3. 如果不是自己，检查关注状态
      if (!this.data.isSelf) {
        await this.checkFollowStatus()
      }

      // 4. 加载用户笔记
      await this.loadUserPosts()

      // 5. 获取背景图
      this.loadBackdropImage()

      this.setData({ pageLoading: false })
    } catch (err) {
      console.error('初始化页面失败:', err)
      this.setData({ pageLoading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 加载用户信息
   */
  async loadUserInfo() {
    const { userId } = this.data

    try {
      // 先尝试通过 _id 查询
      let userRes = await db.collection('users')
        .doc(userId)
        .get()
        .catch(() => null)

      // 如果没找到，尝试通过 _openid 查询
      if (!userRes || !userRes.data) {
        const queryRes = await db.collection('users')
          .where({ _openid: userId })
          .limit(1)
          .get()

        if (queryRes.data && queryRes.data.length > 0) {
          userRes = { data: queryRes.data[0] }
        }
      }

      if (userRes && userRes.data) {
        const user = userRes.data
        this.setData({
          userOpenid: user._openid,
          userInfo: {
            _id: user._id,
            nickname: user.nickname || '用户',
            avatar_url: user.avatar_url || '/images/avatar.png',
            bio: user.bio || '',
            is_certified: user.is_certified || false,
            certified_title: user.certified_title || '非遗爱好者',
            stats: {
              following: user.stats?.following || 0,
              followers: user.stats?.followers || 0,
              likes: (user.stats?.likes || 0) + (user.stats?.collections || 0)
            }
          },
          collectionsVisible: user.collections_public !== false // 默认公开
        })
      } else {
        throw new Error('用户不存在')
      }
    } catch (err) {
      console.error('加载用户信息失败:', err)
      throw err
    }
  },

  /**
   * 检查是否是自己的主页
   */
  checkIsSelf() {
    const currentOpenid = app.globalData.openid
    const { userOpenid, userId } = this.data

    const isSelf = currentOpenid && (
      currentOpenid === userOpenid || 
      currentOpenid === userId
    )

    this.setData({ isSelf })
  },

  /**
   * 检查关注状态
   */
  async checkFollowStatus() {
    const currentOpenid = app.globalData.openid
    const { userOpenid } = this.data

    if (!currentOpenid || !userOpenid) return

    try {
      // 检查当前用户是否关注了主页主人
      const followRes = await db.collection('community_follows')
        .where({
          follower_id: currentOpenid,
          target_id: userOpenid
        })
        .limit(1)
        .get()

      const isFollowing = followRes.data && followRes.data.length > 0

      // 检查互关
      let isMutual = false
      if (isFollowing) {
        const mutualRes = await db.collection('community_follows')
          .where({
            follower_id: userOpenid,
            target_id: currentOpenid
          })
          .limit(1)
          .get()

        isMutual = mutualRes.data && mutualRes.data.length > 0
      }

      this.setData({ isFollowing, isMutual })
    } catch (err) {
      console.error('检查关注状态失败:', err)
    }
  },

  /**
   * 加载用户笔记
   */
  async loadUserPosts() {
    const { userOpenid, isSelf } = this.data

    if (!userOpenid) return

    this.setData({ postsLoading: true })

    try {
      // 构建查询条件
      let query = {
        _openid: userOpenid
      }

      // 非本人只能看公开帖子
      if (!isSelf) {
        query.status = _.neq(1) // status !== 1 (私密)
      }

      const postsRes = await db.collection('community_posts')
        .where(query)
        .orderBy('create_time', 'desc')
        .limit(50)
        .get()

      const posts = postsRes.data || []

      // 归一化 images 格式（兼容新对象数组和旧字符串数组）
      posts.forEach(post => {
        post.images = (post.images || []).map(img => typeof img === 'string' ? img : (img.url || ''))
      })

      // 分配到两列
      const leftPosts = []
      const rightPosts = []
      posts.forEach((item, index) => {
        if (index % 2 === 0) {
          leftPosts.push(item)
        } else {
          rightPosts.push(item)
        }
      })

      this.setData({
        posts,
        leftPosts,
        rightPosts,
        postsLoading: false,
        noMorePosts: posts.length < 50
      })
    } catch (err) {
      console.error('加载用户笔记失败:', err)
      this.setData({ postsLoading: false })
    }
  },

  /**
   * 加载背景图（最新笔记首图）
   */
  loadBackdropImage() {
    const { posts, userInfo } = this.data

    // 优先使用最新笔记的首图
    if (posts.length > 0 && posts[0].images && posts[0].images.length > 0) {
      this.setData({
        backdropImage: posts[0].images[0]
      })
    } else {
      // 没有笔记，使用头像
      this.setData({
        backdropImage: userInfo.avatar_url || '/images/avatar.png'
      })
    }
  },

  /**
   * 加载用户收藏
   */
  async loadUserCollections() {
    const { userOpenid, isSelf, collectionsVisible, collectionsLoaded } = this.data

    if (!userOpenid) return
    if (!isSelf && !collectionsVisible) return
    if (collectionsLoaded) return

    this.setData({ collectionsLoading: true })

    try {
      // 查询收藏关系
      const collectionsRes = await db.collection('community_collections')
        .where({ _openid: userOpenid })
        .orderBy('create_time', 'desc')
        .limit(100)
        .get()

      const collectionRecords = collectionsRes.data || []

      if (collectionRecords.length === 0) {
        this.setData({
          collections: [],
          leftCollections: [],
          rightCollections: [],
          collectionsLoading: false,
          collectionsLoaded: true
        })
        return
      }

      // 获取帖子详情
      const postIds = collectionRecords.map(c => c.post_id)
      const postsRes = await db.collection('community_posts')
        .where({
          _id: _.in(postIds),
          status: _.neq(1) // 过滤私密帖子
        })
        .get()

      // 按收藏顺序排列
      const postsMap = {}
      postsRes.data.forEach(post => {
        postsMap[post._id] = post
      })

      const collections = postIds
        .map(id => postsMap[id])
        .filter(post => post)

      // 分配到两列
      const leftCollections = []
      const rightCollections = []
      collections.forEach((item, index) => {
        if (index % 2 === 0) {
          leftCollections.push(item)
        } else {
          rightCollections.push(item)
        }
      })

      this.setData({
        collections,
        leftCollections,
        rightCollections,
        collectionsLoading: false,
        collectionsLoaded: true
      })
    } catch (err) {
      console.error('加载用户收藏失败:', err)
      this.setData({ collectionsLoading: false })
    }
  },

  /**
   * Tab 切换
   */
  onTabChange(e) {
    const index = e.detail.index
    this.setData({ activeTab: index })

    // 切换到收藏 Tab 时加载数据
    if (index === 1 && !this.data.collectionsLoaded) {
      this.loadUserCollections()
    }
  },

  /**
   * 页面滚动事件
   */
  onPageScroll(e) {
    const scrollTop = e.detail.scrollTop
    const threshold = 200

    // 导航栏状态切换
    const navSolid = scrollTop > threshold
    if (navSolid !== this.data.navSolid) {
      this.setData({ navSolid })
    }
  },

  /**
   * 关注/取关操作
   */
  async toggleFollow() {
    const currentOpenid = app.globalData.openid
    const { userOpenid, isFollowing } = this.data

    if (!currentOpenid) {
      wx.navigateTo({
        url: '/pages/login/login'
      })
      return
    }

    if (!userOpenid) return

    try {
      if (isFollowing) {
        // 取消关注
        await this.unfollowUser()
      } else {
        // 关注用户
        await this.followUser()
      }
    } catch (err) {
      console.error('关注操作失败:', err)
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    }
  },

  /**
   * 关注用户
   */
  async followUser() {
    const currentOpenid = app.globalData.openid
    const { userOpenid, userInfo } = this.data

    // 添加关注记录
    await db.collection('community_follows').add({
      data: {
        follower_id: currentOpenid,
        target_id: userOpenid,
        create_time: db.serverDate()
      }
    })

    // 更新双方计数
    await db.collection('users')
      .where({ _openid: userOpenid })
      .update({
        data: {
          'stats.followers': _.inc(1)
        }
      })

    await db.collection('users')
      .where({ _openid: currentOpenid })
      .update({
        data: {
          'stats.following': _.inc(1)
        }
      })

    // 检查是否互关
    const mutualRes = await db.collection('community_follows')
      .where({
        follower_id: userOpenid,
        target_id: currentOpenid
      })
      .limit(1)
      .get()

    const isMutual = mutualRes.data && mutualRes.data.length > 0

    this.setData({
      isFollowing: true,
      isMutual,
      'userInfo.stats.followers': userInfo.stats.followers + 1
    })

    wx.showToast({
      title: isMutual ? '已互相关注' : '关注成功',
      icon: 'success'
    })
  },

  /**
   * 取消关注
   */
  async unfollowUser() {
    const currentOpenid = app.globalData.openid
    const { userOpenid, userInfo } = this.data

    // 删除关注记录
    await db.collection('community_follows')
      .where({
        follower_id: currentOpenid,
        target_id: userOpenid
      })
      .remove()

    // 更新双方计数
    await db.collection('users')
      .where({ _openid: userOpenid })
      .update({
        data: {
          'stats.followers': _.inc(-1)
        }
      })

    await db.collection('users')
      .where({ _openid: currentOpenid })
      .update({
        data: {
          'stats.following': _.inc(-1)
        }
      })

    this.setData({
      isFollowing: false,
      isMutual: false,
      'userInfo.stats.followers': Math.max(0, userInfo.stats.followers - 1)
    })

    wx.showToast({
      title: '已取消关注',
      icon: 'success'
    })
  },

  /**
   * 跳转到私聊
   */
  goToChat() {
    const currentOpenid = app.globalData.openid
    const { userOpenid } = this.data

    if (!currentOpenid) {
      wx.navigateTo({
        url: '/pages/login/login'
      })
      return
    }

    if (!userOpenid) return

    wx.navigateTo({
      url: `/pages/chat/room?targetUserId=${userOpenid}`
    })
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
    const { userOpenid, isSelf } = this.data
    wx.navigateTo({
      url: `/pages/user/relations?tab=0&userId=${isSelf ? '' : userOpenid}`
    })
  },

  /**
   * 跳转到粉丝列表
   */
  goToFollowers() {
    const { userOpenid, isSelf } = this.data
    wx.navigateTo({
      url: `/pages/user/relations?tab=1&userId=${isSelf ? '' : userOpenid}`
    })
  },

  /**
   * 跳转到发布页
   */
  goToPost() {
    wx.navigateTo({
      url: '/pages/community/post'
    })
  },

  /**
   * 跳转到编辑资料
   */
  goToEditProfile() {
    wx.showToast({
      title: '编辑资料功能开发中',
      icon: 'none'
    })
  },

  /**
   * 返回上一页
   */
  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/home/home'
        })
      }
    })
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 如果已经加载过，刷新关注状态
    if (!this.data.pageLoading && !this.data.isSelf) {
      this.checkFollowStatus()
    }
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.initPage().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    const { userInfo, userId } = this.data
    return {
      title: `${userInfo.nickname} 的主页 - 湘韵遗珍`,
      path: `/pages/community/user-profile?userId=${userId}`,
      imageUrl: userInfo.avatar_url
    }
  }
})

