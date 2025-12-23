// pages/community/index.js
const app = getApp()
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    postList: [],      // 全部帖子
    leftColumn: [],    // 左列帖子
    rightColumn: [],   // 右列帖子
    loading: true
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.loadPosts()
  },

  /**
   * 加载帖子列表
   */
  async loadPosts() {
    this.setData({ loading: true })

    try {
      console.log('=== 加载社区帖子 ===')

      // 1. 查询帖子列表
      const res = await db.collection('community_posts')
        .orderBy('create_time', 'desc')
        .limit(100)  // 多查一些，因为要过滤私密帖子
        .get()

      console.log('帖子数据:', res.data)

      const myOpenid = app.globalData.openid

      // 2. 过滤私密帖子（status=1 的帖子只有作者可见）
      let postList = res.data.filter(post => {
        // 公开帖子（status 为 0 或 undefined）所有人可见
        if (!post.status || post.status === 0) return true
        // 私密帖子只有作者本人可见
        return post._openid === myOpenid
      }).slice(0, 50)  // 只取前50条

      // 3. 批量查询当前用户的点赞状态
      if (myOpenid && postList.length > 0) {
        const postIds = postList.map(item => item._id)
        
        // 查询我点赞过的帖子
        const _ = db.command
        const likedRes = await db.collection('community_post_likes')
          .where({
            target_id: _.in(postIds),
            _openid: myOpenid
          })
          .field({ target_id: true })
          .get()

        const likedPostIds = (likedRes.data || []).map(item => item.target_id)
        console.log('已点赞的帖子:', likedPostIds)

        // 4. 合并点赞状态到帖子列表
        postList = postList.map(item => ({
          ...item,
          isLiked: likedPostIds.includes(item._id)
        }))
      } else {
        // 未登录时，所有帖子默认未点赞
        postList = postList.map(item => ({
          ...item,
          isLiked: false
        }))
      }

      // 4. 分配到左右两列（交替分配实现瀑布流效果）
      const leftColumn = []
      const rightColumn = []

      postList.forEach((item, index) => {
        if (index % 2 === 0) {
          leftColumn.push(item)
        } else {
          rightColumn.push(item)
        }
      })

      this.setData({
        postList,
        leftColumn,
        rightColumn,
        loading: false
      })

      if (postList.length === 0) {
        console.warn('暂无帖子数据')
      }

    } catch (err) {
      console.error('加载帖子失败:', err)
      this.setData({ loading: false })
      
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 跳转到详情页
   */
  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    const isLiked = e.currentTarget.dataset.isliked
    wx.navigateTo({
      url: `/pages/community/detail?id=${id}&isLiked=${isLiked}`
    })
  },

  /**
   * 更新单个帖子的点赞状态（供详情页回调）
   */
  updatePostLikeStatus(postId, isLiked, likesCount) {
    const postList = this.data.postList.map(item => {
      if (item._id === postId) {
        return { ...item, isLiked, likes: likesCount }
      }
      return item
    })

    // 重新分配左右列
    const leftColumn = []
    const rightColumn = []
    postList.forEach((item, index) => {
      if (index % 2 === 0) {
        leftColumn.push(item)
      } else {
        rightColumn.push(item)
      }
    })

    this.setData({ postList, leftColumn, rightColumn })
  },

  /**
   * 跳转到发布页（需要登录）
   */
  goToPost() {
    // 检查登录状态
    if (!app.requireLogin('/pages/community/post')) {
      return
    }
    wx.navigateTo({
      url: '/pages/community/post'
    })
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

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
    this.loadPosts().then(() => {
      wx.stopPullDownRefresh()
    })
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

