// pages/community/topic.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command

// 每页加载数量
const PAGE_SIZE = 20

Page({
  /**
   * 页面的初始数据
   */
  data: {
    tagName: '',              // 话题名称
    topicStats: {             // 话题统计
      count: 0,
      countFormatted: '0',
      viewCount: 0,
      viewCountFormatted: '0'
    },
    heroImage: '',            // 头部背景图（最热帖子的封面）
    activeTab: 'hot',         // 默认选中热门
    postList: [],             // 帖子列表
    leftColumn: [],           // 左列
    rightColumn: [],          // 右列
    loading: true,            // 首次加载
    loadingMore: false,       // 加载更多
    noMore: false,            // 没有更多
    lastDoc: null,            // 分页游标
    statusBarHeight: 20,      // 状态栏高度
    tabSwitching: false,      // Tab 切换中（轻量级加载）
    topicId: ''               // 话题ID
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 获取系统信息
    const systemInfo = wx.getWindowInfo()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20
    })

    if (!options.tag) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    const tagName = decodeURIComponent(options.tag)
    this.setData({ tagName })
    
    // 并行加载数据
    Promise.all([
      this.loadTopicStats(),
      this.loadPosts(true),
      this.loadHeroImage()
    ])
  },

  /**
   * 返回上一页
   */
  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/community/index' })
      }
    })
  },

  /**
   * 分享
   */
  onShare() {
    // 触发分享
  },

  /**
   * 加载话题统计信息
   */
  async loadTopicStats() {
    try {
      const res = await db.collection('community_topics')
        .where({ name: this.data.tagName })
        .get()

      if (res.data && res.data.length > 0) {
        const topic = res.data[0]
        
        // 统计该话题下所有帖子的浏览量
        let totalViewCount = 0
        try {
          const viewRes = await db.collection('community_posts')
            .where({
              tags: this.data.tagName,
              status: _.neq(1)
            })
            .field({ view_count: true })
            .get()
          
          totalViewCount = (viewRes.data || []).reduce((sum, post) => {
            return sum + (post.view_count || 0)
          }, 0)
        } catch (err) {
          console.warn('统计浏览量失败:', err)
        }

        this.setData({
          topicId: topic._id,
          topicStats: {
            count: topic.count || 0,
            countFormatted: this.formatCount(topic.count || 0),
            viewCount: totalViewCount,
            viewCountFormatted: this.formatCount(totalViewCount)
          }
        })
      }
    } catch (err) {
      console.warn('加载话题统计失败:', err)
    }
  },

  /**
   * 加载头部背景图（使用最热帖子的封面）
   */
  async loadHeroImage() {
    try {
      const res = await db.collection('community_posts')
        .where({
          tags: this.data.tagName,
          status: _.neq(1)
        })
        .orderBy('hot_score', 'desc')
        .limit(1)
        .field({ images: true })
        .get()

      if (res.data && res.data.length > 0 && res.data[0].images && res.data[0].images.length > 0) {
        this.setData({
          heroImage: res.data[0].images[0]
        })
      }
    } catch (err) {
      console.warn('加载头部背景图失败:', err)
    }
  },

  /**
   * 加载帖子列表
   * @param {boolean} isRefresh - 是否刷新
   * @param {boolean} isTabSwitch - 是否为 Tab 切换触发
   */
  async loadPosts(isRefresh = false, isTabSwitch = false) {
    if (isRefresh) {
      // Tab 切换时使用轻量级加载，不清空列表
      if (isTabSwitch) {
        this.setData({
          tabSwitching: true,
          lastDoc: null,
          noMore: false
        })
      } else {
        this.setData({
          loading: true,
          postList: [],
          leftColumn: [],
          rightColumn: [],
          lastDoc: null,
          noMore: false
        })
      }
    } else {
      if (this.data.loadingMore || this.data.noMore) return
      this.setData({ loadingMore: true })
    }

    try {
      const tagName = this.data.tagName
      const activeTab = this.data.activeTab
      const myOpenid = app.globalData.openid

      // 构建查询
      let query = db.collection('community_posts')
        .where({
          tags: tagName,
          status: _.neq(1)  // 排除私密帖子（status !== 1）
        })

      // 根据 Tab 排序
      if (activeTab === 'hot') {
        query = query.orderBy('hot_score', 'desc')
      } else {
        query = query.orderBy('create_time', 'desc')
      }

      // 分页（非刷新时）
      if (!isRefresh && this.data.postList.length > 0) {
        query = query.skip(this.data.postList.length)
      }

      const res = await query.limit(PAGE_SIZE).get()
      const newPosts = res.data || []

      // 格式化帖子数据
      const formattedPosts = newPosts.map(post => ({
        ...post,
        likesFormatted: this.formatCount(post.likes || 0)
      }))

      // 合并数据
      const allPosts = isRefresh 
        ? formattedPosts 
        : [...this.data.postList, ...formattedPosts]

      // 批量查询点赞状态
      let likedPostIds = []
      if (myOpenid && allPosts.length > 0) {
        try {
          const postIds = allPosts.map(p => p._id)
          const likesRes = await db.collection('community_post_likes')
            .where({
              target_id: _.in(postIds),
              _openid: myOpenid
            })
            .field({ target_id: true })
            .get()
          likedPostIds = (likesRes.data || []).map(item => item.target_id)
        } catch (err) {
          console.warn('获取点赞状态失败:', err)
        }
      }

      // 合并点赞状态
      const postsWithLikeStatus = allPosts.map(post => ({
        ...post,
        isLiked: likedPostIds.includes(post._id)
      }))

      // 分配到左右两列
      const leftColumn = []
      const rightColumn = []
      postsWithLikeStatus.forEach((item, index) => {
        if (index % 2 === 0) {
          leftColumn.push(item)
        } else {
          rightColumn.push(item)
        }
      })

      this.setData({
        postList: postsWithLikeStatus,
        leftColumn,
        rightColumn,
        loading: false,
        loadingMore: false,
        tabSwitching: false,
        noMore: newPosts.length < PAGE_SIZE,
        lastDoc: newPosts.length > 0 ? newPosts[newPosts.length - 1] : null
      })

    } catch (err) {
      console.error('加载帖子失败:', err)
      this.setData({
        loading: false,
        loadingMore: false,
        tabSwitching: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * Tab 点击切换
   */
  onTabTap(e) {
    const activeTab = e.currentTarget.dataset.tab
    if (activeTab === this.data.activeTab) return
    if (this.data.tabSwitching) return // 防止重复点击

    this.setData({ activeTab })
    // 使用轻量级加载（isTabSwitch = true）
    this.loadPosts(true, true)
  },

  /**
   * 跳转到帖子详情
   */
  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    const isLiked = e.currentTarget.dataset.isliked
    wx.navigateTo({
      url: `/pages/community/detail?id=${id}&isLiked=${isLiked}`
    })
  },

  /**
   * 跳转到发布页，自动带上当前话题
   */
  goToPost() {
    const tagName = this.data.tagName
    wx.navigateTo({
      url: `/pages/community/post?defaultTag=${encodeURIComponent(tagName)}`
    })
  },

  /**
   * 格式化数字
   */
  formatCount(num) {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w'
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k'
    }
    return String(num)
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    Promise.all([
      this.loadTopicStats(),
      this.loadPosts(true),
      this.loadHeroImage()
    ]).then(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    this.loadPosts(false)
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: `# ${this.data.tagName} - 一起来看看吧`,
      path: `/pages/community/topic?tag=${encodeURIComponent(this.data.tagName)}`,
      imageUrl: this.data.heroImage || ''
    }
  }
})
