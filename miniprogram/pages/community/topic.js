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
      countFormatted: '0'
    },
    activeTab: 'latest',      // 当前 Tab：latest / hot
    postList: [],             // 帖子列表
    leftColumn: [],           // 左列
    rightColumn: [],          // 右列
    loading: true,            // 首次加载
    loadingMore: false,       // 加载更多
    noMore: false,            // 没有更多
    lastDoc: null             // 分页游标
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    if (!options.tag) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    const tagName = decodeURIComponent(options.tag)
    
    // 设置导航栏标题
    wx.setNavigationBarTitle({
      title: `# ${tagName}`
    })

    this.setData({ tagName })
    
    // 加载话题统计和帖子列表
    this.loadTopicStats()
    this.loadPosts(true)
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
        this.setData({
          topicStats: {
            count: topic.count || 0,
            countFormatted: this.formatCount(topic.count || 0)
          }
        })
      }
    } catch (err) {
      console.warn('加载话题统计失败:', err)
    }
  },

  /**
   * 加载帖子列表
   */
  async loadPosts(isRefresh = false) {
    if (isRefresh) {
      this.setData({
        loading: true,
        postList: [],
        leftColumn: [],
        rightColumn: [],
        lastDoc: null,
        noMore: false
      })
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

      // 分页
      if (!isRefresh && this.data.lastDoc) {
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
        noMore: newPosts.length < PAGE_SIZE,
        lastDoc: newPosts.length > 0 ? newPosts[newPosts.length - 1] : null
      })

    } catch (err) {
      console.error('加载帖子失败:', err)
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
   * Tab 切换
   */
  onTabChange(e) {
    const activeTab = e.detail.name
    if (activeTab === this.data.activeTab) return

    this.setData({ activeTab })
    this.loadPosts(true)
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
      this.loadPosts(true)
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
      title: `# ${this.data.tagName}`,
      path: `/pages/community/topic?tag=${encodeURIComponent(this.data.tagName)}`
    }
  }
})

