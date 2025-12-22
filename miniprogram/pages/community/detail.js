// pages/community/detail.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command

Page({
  /**
   * 页面的初始数据
   */
  data: {
    postId: '',
    postData: null,
    authorData: null,
    authorDataLoaded: false,
    loading: true,
    isFollowing: false,
    isMutual: false,
    isSelf: false,
    followStatusLoaded: false,
    currentImageIndex: 0,
    formatTime: '',
    swiperHeight: 400,
    imageHeights: [],
    likesFormatted: '0',
    
    // ========== 评论相关 ==========
    commentCount: 0,           // 评论总数
    commentsFormatted: '0',    // 格式化的评论数
    commentList: [],           // 一级评论列表
    commentsLoading: false,    // 评论加载中
    
    // 输入框状态
    inputFocus: false,         // 输入框是否聚焦
    inputValue: '',            // 输入框内容
    inputPlaceholder: '说点什么...', // 输入框占位符
    
    // 回复状态
    replyMode: 'post',         // 'post' 回复帖子, 'comment' 回复评论
    replyTarget: null,         // 回复目标 { _id, root_id, nickname }
    
    // 当前用户
    currentOpenid: '',         // 当前用户的 openid，用于判断是否显示删除按钮
    
    // 点赞相关
    isLiked: false,            // 是否已点赞
    likesCount: 0,             // 点赞数
  },

  /**
   * 生命周期函数--监听页面加载
   */
  async onLoad(options) {
    if (!options.id) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
      return
    }

    this.setData({
      postId: options.id,
      currentOpenid: app.globalData.openid || ''
    })

    await this.loadPostDetail()
  },

  /**
   * 加载帖子详情
   */
  async loadPostDetail() {
    this.setData({ loading: true })

    try {
      const postRes = await db.collection('community_posts')
        .doc(this.data.postId)
        .get()

      if (!postRes.data) {
        this.setData({ loading: false })
        wx.showToast({
          title: '帖子不存在',
          icon: 'none'
        })
        return
      }

      const postData = postRes.data

      // 格式化发布时间
      const formatTime = this.formatDate(postData.create_time)
      
      // 获取点赞数
      const likesCount = postData.likes || 0
      const likesFormatted = this.formatCount(likesCount)
      
      // 获取评论数（从 comment_count 字段，如果没有则默认0）
      const commentCount = postData.comment_count || 0
      const commentsFormatted = this.formatCount(commentCount)

      // 检查是否是自己的帖子（立即判断）
      const myOpenid = app.globalData.openid
      const isSelf = myOpenid && postData._openid === myOpenid

      console.log('帖子详情:', postData)

      // 并行加载：关注状态 + 作者信息 + 点赞状态，全部完成后再显示页面
      await Promise.all([
        this.checkFollowStatus(postData._openid),
        this.loadAuthorData(postData.author_id),
        this.checkLikeStatus()
      ])

      // 所有数据加载完成后，一次性更新页面
      this.setData({
        postData,
        formatTime,
        likesCount,
        likesFormatted,
        isLiked: this.data.isLiked,
        commentCount,
        commentsFormatted,
        imageHeights: new Array(postData.images ? postData.images.length : 0).fill(0),
        isSelf: isSelf,
        isFollowing: this.data.isFollowing,
        isMutual: this.data.isMutual,
        followStatusLoaded: this.data.followStatusLoaded,
        authorData: this.data.authorData,
        authorDataLoaded: this.data.authorDataLoaded,
        loading: false
      })

      // 加载评论列表（不阻塞页面显示）
      this.loadComments()

    } catch (err) {
      console.error('加载帖子详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  // ========== 评论相关方法 ==========

  /**
   * 加载一级评论列表
   */
  async loadComments() {
    this.setData({ commentsLoading: true })

    try {
      // 查询一级评论（root_id 为空或等于自身）
      const res = await db.collection('community_comments')
        .where({
          post_id: this.data.postId,
          root_id: '' // 一级评论
        })
        .orderBy('create_time', 'desc')
        .limit(50)
        .get()

      const comments = res.data || []

      // 获取当前用户点赞的评论ID列表
      const myOpenid = app.globalData.openid
      let likedCommentIds = []
      if (myOpenid) {
        try {
          const likesRes = await db.collection('community_comment_likes')
            .where({
              user_id: myOpenid,
              post_id: this.data.postId
            })
            .get()
          likedCommentIds = (likesRes.data || []).map(item => item.comment_id)
        } catch (err) {
          console.warn('获取评论点赞状态失败:', err)
        }
      }

      // 为每条一级评论加载前2条子评论
      const commentList = await Promise.all(comments.map(async (comment) => {
        // 格式化时间
        comment.create_time_formatted = this.formatCommentTime(comment.create_time)
        comment.replies = []
        comment.repliesLoaded = false
        comment.showAllReplies = false
        comment.isLiked = likedCommentIds.includes(comment._id)

        // 如果有回复，加载前2条
        if (comment.reply_count > 0) {
          const repliesRes = await db.collection('community_comments')
            .where({
              root_id: comment._id
            })
            .orderBy('create_time', 'asc')
            .limit(2)
            .get()

          comment.replies = (repliesRes.data || []).map(reply => ({
            ...reply,
            create_time_formatted: this.formatCommentTime(reply.create_time),
            isLiked: likedCommentIds.includes(reply._id)
          }))
          comment.repliesLoaded = true
        }

        return comment
      }))

      this.setData({
        commentList,
        commentsLoading: false
      })

      console.log('评论列表:', commentList)

    } catch (err) {
      console.error('加载评论失败:', err)
      this.setData({ commentsLoading: false })
    }
  },

  /**
   * 展开更多回复
   */
  async expandReplies(e) {
    const commentId = e.currentTarget.dataset.commentid
    const index = e.currentTarget.dataset.index

    try {
      // 加载该一级评论下的所有子评论
      const res = await db.collection('community_comments')
        .where({
          root_id: commentId
        })
        .orderBy('create_time', 'asc')
        .get()

      // 获取当前用户点赞的评论ID列表
      const myOpenid = app.globalData.openid
      let likedCommentIds = []
      if (myOpenid) {
        try {
          const replyIds = (res.data || []).map(r => r._id)
          if (replyIds.length > 0) {
            const likesRes = await db.collection('community_comment_likes')
              .where({
                user_id: myOpenid,
                comment_id: _.in(replyIds)
              })
              .get()
            likedCommentIds = (likesRes.data || []).map(item => item.comment_id)
          }
        } catch (err) {
          console.warn('获取回复点赞状态失败:', err)
        }
      }

      const replies = (res.data || []).map(reply => ({
        ...reply,
        create_time_formatted: this.formatCommentTime(reply.create_time),
        isLiked: likedCommentIds.includes(reply._id)
      }))

      // 更新对应评论的回复列表
      const commentList = [...this.data.commentList]
      commentList[index].replies = replies
      commentList[index].showAllReplies = true

      this.setData({ commentList })

    } catch (err) {
      console.error('加载更多回复失败:', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 收起回复
   */
  collapseReplies(e) {
    const index = e.currentTarget.dataset.index
    const commentList = [...this.data.commentList]
    
    // 只保留前2条回复
    commentList[index].replies = commentList[index].replies.slice(0, 2)
    commentList[index].showAllReplies = false

    this.setData({ commentList })
  },

  /**
   * 检查点赞状态
   */
  async checkLikeStatus() {
    const myOpenid = app.globalData.openid
    if (!myOpenid) return

    try {
      const res = await db.collection('community_likes')
        .where({
          post_id: this.data.postId,
          user_id: myOpenid
        })
        .count()

      this.setData({
        isLiked: res.total > 0
      })
    } catch (err) {
      console.warn('检查点赞状态失败:', err)
    }
  },

  /**
   * 点赞/取消点赞
   */
  async onLikeTap() {
    // 检查登录状态
    if (!app.globalData.openid) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }

    const myOpenid = app.globalData.openid
    const isLiked = this.data.isLiked

    try {
      if (isLiked) {
        // 取消点赞
        await db.collection('community_likes')
          .where({
            post_id: this.data.postId,
            user_id: myOpenid
          })
          .remove()

        // 调用云函数原子更新帖子点赞数 -1
        await wx.cloud.callFunction({
          name: 'update_stats',
          data: {
            collection: 'community_posts',
            docId: this.data.postId,
            field: 'likes',
            amount: -1
          }
        })

        this.setData({
          isLiked: false,
          likesCount: Math.max(0, this.data.likesCount - 1),
          likesFormatted: this.formatCount(Math.max(0, this.data.likesCount - 1))
        })

      } else {
        // 点赞
        await db.collection('community_likes').add({
          data: {
            post_id: this.data.postId,
            user_id: myOpenid,
            create_time: db.serverDate()
          }
        })

        // 调用云函数原子更新帖子点赞数 +1
        await wx.cloud.callFunction({
          name: 'update_stats',
          data: {
            collection: 'community_posts',
            docId: this.data.postId,
            field: 'likes',
            amount: 1
          }
        })

        this.setData({
          isLiked: true,
          likesCount: this.data.likesCount + 1,
          likesFormatted: this.formatCount(this.data.likesCount + 1)
        })

        wx.showToast({
          title: '已点赞',
          icon: 'none',
          duration: 1000
        })
      }
    } catch (err) {
      console.error('点赞操作失败:', err)
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    }
  },

  /**
   * 评论点赞/取消点赞
   */
  async onCommentLikeTap(e) {
    // 检查登录状态
    if (!app.globalData.openid) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }

    const commentId = e.currentTarget.dataset.commentid
    const commentIndex = e.currentTarget.dataset.index
    const replyIndex = e.currentTarget.dataset.replyindex
    const isReply = replyIndex !== undefined && replyIndex !== null && replyIndex !== ''
    const myOpenid = app.globalData.openid

    // 获取当前评论对象
    let comment
    if (isReply) {
      comment = this.data.commentList[commentIndex].replies[replyIndex]
    } else {
      comment = this.data.commentList[commentIndex]
    }

    const isLiked = comment.isLiked

    try {
      if (isLiked) {
        // 取消点赞
        await db.collection('community_comment_likes')
          .where({
            comment_id: commentId,
            user_id: myOpenid
          })
          .remove()

        // 调用云函数更新评论点赞数 -1
        await wx.cloud.callFunction({
          name: 'update_stats',
          data: {
            collection: 'community_comments',
            docId: commentId,
            field: 'like_count',
            amount: -1
          }
        })

        // 更新本地数据
        const commentList = [...this.data.commentList]
        if (isReply) {
          commentList[commentIndex].replies[replyIndex].isLiked = false
          commentList[commentIndex].replies[replyIndex].like_count = Math.max(0, (comment.like_count || 0) - 1)
        } else {
          commentList[commentIndex].isLiked = false
          commentList[commentIndex].like_count = Math.max(0, (comment.like_count || 0) - 1)
        }
        this.setData({ commentList })

      } else {
        // 点赞
        await db.collection('community_comment_likes').add({
          data: {
            comment_id: commentId,
            post_id: this.data.postId,
            user_id: myOpenid,
            create_time: db.serverDate()
          }
        })

        // 调用云函数更新评论点赞数 +1
        await wx.cloud.callFunction({
          name: 'update_stats',
          data: {
            collection: 'community_comments',
            docId: commentId,
            field: 'like_count',
            amount: 1
          }
        })

        // 更新本地数据
        const commentList = [...this.data.commentList]
        if (isReply) {
          commentList[commentIndex].replies[replyIndex].isLiked = true
          commentList[commentIndex].replies[replyIndex].like_count = (comment.like_count || 0) + 1
        } else {
          commentList[commentIndex].isLiked = true
          commentList[commentIndex].like_count = (comment.like_count || 0) + 1
        }
        this.setData({ commentList })
      }
    } catch (err) {
      console.error('评论点赞操作失败:', err)
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    }
  },

  /**
   * 删除评论
   */
  async onDeleteComment(e) {
    const commentId = e.currentTarget.dataset.commentid
    const commentIndex = e.currentTarget.dataset.index
    const replyIndex = e.currentTarget.dataset.replyindex
    const isReply = replyIndex !== undefined && replyIndex !== null && replyIndex !== ''

    // 获取评论对象
    let comment
    if (isReply) {
      comment = this.data.commentList[commentIndex].replies[replyIndex]
    } else {
      comment = this.data.commentList[commentIndex]
    }

    // 确认删除
    const res = await wx.showModal({
      title: '删除评论',
      content: isReply ? '确定要删除这条回复吗？' : '确定要删除这条评论吗？删除后其下所有回复也将被删除。',
      confirmText: '删除',
      confirmColor: '#b63b36'
    })

    if (!res.confirm) return

    wx.showLoading({ title: '删除中...' })

    try {
      // 判断是一级评论还是二级评论
      const isRootComment = !comment.root_id || comment.root_id === ''

      // 调用云函数删除
      const result = await wx.cloud.callFunction({
        name: 'delete_comment',
        data: {
          commentId: comment._id,
          postId: this.data.postId,
          isRootComment: isRootComment
        }
      })

      wx.hideLoading()

      if (result.result && result.result.success) {
        wx.showToast({
          title: '删除成功',
          icon: 'success'
        })

        // 更新本地数据
        const commentList = [...this.data.commentList]
        let newCommentCount = this.data.commentCount

        if (isRootComment) {
          // 删除一级评论：从列表中移除
          const deletedComment = commentList[commentIndex]
          const deletedCount = 1 + (deletedComment.reply_count || 0)
          commentList.splice(commentIndex, 1)
          newCommentCount = Math.max(0, newCommentCount - deletedCount)
        } else {
          // 删除二级评论：逻辑删除，更新显示内容
          commentList[commentIndex].replies[replyIndex].status = 'deleted'
          commentList[commentIndex].replies[replyIndex].content = '该评论已由作者删除'
          commentList[commentIndex].replies[replyIndex].like_count = 0
          commentList[commentIndex].replies[replyIndex].isLiked = false
        }

        this.setData({
          commentList,
          commentCount: newCommentCount
        })

      } else {
        wx.showToast({
          title: result.result?.message || '删除失败',
          icon: 'none'
        })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('删除评论失败:', err)
      wx.showToast({
        title: '删除失败',
        icon: 'none'
      })
    }
  },

  /**
   * 点击输入框区域 - 回复帖子
   */
  onInputAreaTap() {
    this.setData({
      replyMode: 'post',
      replyTarget: null,
      inputPlaceholder: '说点什么...',
      inputFocus: true
    })
  },

  /**
   * 点击评论 - 回复该评论
   */
  onCommentTap(e) {
    const comment = e.currentTarget.dataset.comment
    const isL1 = !comment.root_id || comment.root_id === ''

    this.setData({
      replyMode: 'comment',
      replyTarget: {
        _id: comment._id,
        root_id: isL1 ? comment._id : comment.root_id, // L1评论的root_id是自己，L2评论取其root_id
        nickname: comment.user_info?.nickname || '该用户',
        from_uid: comment.from_uid
      },
      inputPlaceholder: `回复 @${comment.user_info?.nickname || '该用户'}`,
      inputFocus: true
    })
  },

  /**
   * 输入框内容变化
   */
  onInputChange(e) {
    this.setData({
      inputValue: e.detail.value
    })
  },

  /**
   * 输入框失焦
   */
  onInputBlur() {
    // 延迟关闭，避免点击发送按钮时失焦导致无法发送
    setTimeout(() => {
      if (!this.data.inputValue) {
        this.setData({
          inputFocus: false,
          replyMode: 'post',
          replyTarget: null,
          inputPlaceholder: '说点什么...'
        })
      }
    }, 200)
  },

  /**
   * 发送评论
   */
  async sendComment() {
    const content = this.data.inputValue.trim()
    
    if (!content) {
      wx.showToast({
        title: '请输入评论内容',
        icon: 'none'
      })
      return
    }

    // 检查登录状态
    if (!app.globalData.openid || !app.globalData.userInfo) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }

    wx.showLoading({ title: '发送中...' })

    try {
      const myOpenid = app.globalData.openid
      const userInfo = app.globalData.userInfo

      // 构造评论数据
      const commentData = {
        post_id: this.data.postId,
        root_id: '',      // 一级评论
        parent_id: '',    // 无父评论
        from_uid: myOpenid,
        user_info: {
          nickname: userInfo.nickname,
          avatar: userInfo.avatar_url
        },
        content: content,
        create_time: db.serverDate(),
        reply_count: 0,
        like_count: 0
      }

      // 如果是回复评论
      if (this.data.replyMode === 'comment' && this.data.replyTarget) {
        const target = this.data.replyTarget
        commentData.root_id = target.root_id  // 所属一级评论ID
        commentData.parent_id = target._id    // 直接父级ID
        commentData.reply_to = {
          uid: target.from_uid,
          nickname: target.nickname
        }
      }

      // 写入评论
      const addRes = await db.collection('community_comments').add({
        data: commentData
      })

      // 调用云函数原子更新帖子的评论数
      await wx.cloud.callFunction({
        name: 'update_stats',
        data: {
          collection: 'community_posts',
          docId: this.data.postId,
          field: 'comment_count',
          amount: 1
        }
      })

      // 如果是二级评论，调用云函数更新一级评论的 reply_count
      if (commentData.root_id) {
        await wx.cloud.callFunction({
          name: 'update_stats',
          data: {
            collection: 'community_comments',
            docId: commentData.root_id,
            field: 'reply_count',
            amount: 1
          }
        })
      }

      wx.hideLoading()
      wx.showToast({
        title: '评论成功',
        icon: 'success'
      })

      // 清空输入框，重置状态
      this.setData({
        inputValue: '',
        inputFocus: false,
        replyMode: 'post',
        replyTarget: null,
        inputPlaceholder: '说点什么...',
        commentCount: this.data.commentCount + 1,
        commentsFormatted: this.formatCount(this.data.commentCount + 1)
      })

      // 刷新评论列表
      this.loadComments()

    } catch (err) {
      console.error('发送评论失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '发送失败',
        icon: 'none'
      })
    }
  },

  /**
   * 格式化评论时间（更友好的显示）
   */
  formatCommentTime(date) {
    if (!date) return ''
    
    const d = new Date(date)
    const now = new Date()
    const diff = now - d
    
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days < 7) return `${days}天前`
    
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    
    if (year === now.getFullYear()) {
      return `${month}-${day}`
    }
    return `${year}-${month}-${day}`
  },

  // ========== 原有方法 ==========

  /**
   * 格式化数字（1000显示为1k，10000显示为1w）
   */
  formatCount(num) {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w'
    } else if (num >= 1000) {
      return (num / 1000).toFixed(0) + 'k'
    }
    return String(num)
  },

  /**
   * 格式化日期
   */
  formatDate(date) {
    if (!date) return ''
    
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    
    return `${year}-${month}-${day}`
  },

  /**
   * 图片加载完成，计算高度
   */
  onImageLoad(e) {
    const { width, height } = e.detail
    const index = e.currentTarget.dataset.index
    
    const systemInfo = wx.getSystemInfoSync()
    const screenWidth = systemInfo.windowWidth
    const realHeight = (screenWidth / width) * height
    
    const imageHeights = [...this.data.imageHeights]
    imageHeights[index] = realHeight
    
    const maxHeight = Math.max(...imageHeights.filter(h => h > 0))
    
    this.setData({
      imageHeights,
      swiperHeight: maxHeight > 0 ? maxHeight : 400
    })
  },

  /**
   * 轮播图切换
   */
  onSwiperChange(e) {
    this.setData({
      currentImageIndex: e.detail.current
    })
  },

  /**
   * 预览图片
   */
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({
      current: url,
      urls: this.data.postData.images
    })
  },

  /**
   * 跳转到非遗项目详情
   */
  goToProject(e) {
    const projectId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/resource/project-detail?id=${projectId}`
    })
  },

  /**
   * 打开位置地图
   */
  openLocation() {
    const location = this.data.postData.location
    if (!location || !location.latitude || !location.longitude) {
      wx.showToast({
        title: '暂无位置信息',
        icon: 'none'
      })
      return
    }

    wx.openLocation({
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name,
      scale: 15
    })
  },

  /**
   * 检查关注状态（包括互关）
   */
  async checkFollowStatus(targetOpenid) {
    const myOpenid = app.globalData.openid
    if (!myOpenid || !targetOpenid || myOpenid === targetOpenid) {
      this.data.followStatusLoaded = true
      return
    }

    try {
      const [iFollowRes, followMeRes] = await Promise.all([
        db.collection('community_follows')
          .where({
            follower_id: myOpenid,
            target_id: targetOpenid
          })
          .count(),
        db.collection('community_follows')
          .where({
            follower_id: targetOpenid,
            target_id: myOpenid
          })
          .count()
      ])

      const isFollowing = iFollowRes.total > 0
      const isFollowedByTarget = followMeRes.total > 0

      this.data.isFollowing = isFollowing
      this.data.isMutual = isFollowing && isFollowedByTarget
      this.data.followStatusLoaded = true
    } catch (err) {
      console.warn('检查关注状态失败:', err)
      this.data.followStatusLoaded = true
    }
  },

  /**
   * 加载作者详情
   */
  async loadAuthorData(authorId) {
    if (!authorId) {
      this.data.authorDataLoaded = true
      return
    }

    try {
      const authorRes = await db.collection('users')
        .doc(authorId)
        .get()
      
      if (authorRes.data) {
        this.data.authorData = authorRes.data
      }
      this.data.authorDataLoaded = true
    } catch (err) {
      console.warn('查询作者信息失败:', err)
      this.data.authorDataLoaded = true
    }
  },

  /**
   * 关注/取消关注操作
   */
  async onFollowTap() {
    const postData = this.data.postData
    if (!postData) return

    if (!app.globalData.openid) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }

    const myOpenid = app.globalData.openid
    const targetOpenid = postData._openid

    if (myOpenid === targetOpenid) {
      return
    }

    if (this.data.isFollowing) {
      const nickname = postData.author_info?.nickname || '该用户'
      wx.showModal({
        title: '取消关注',
        content: `确定要取消关注「${nickname}」吗？`,
        confirmColor: '#b63b36',
        success: async (res) => {
          if (res.confirm) {
            await this.doUnfollow(targetOpenid)
          }
        }
      })
      return
    }

    await this.doFollow(targetOpenid)
  },

  /**
   * 执行关注
   */
  async doFollow(targetOpenid) {
    const myOpenid = app.globalData.openid

    wx.showLoading({ title: '处理中...' })

    try {
      await db.collection('community_follows').add({
        data: {
          follower_id: myOpenid,
          target_id: targetOpenid,
          create_time: db.serverDate()
        }
      })

      // 调用云函数更新双方的统计数据
      await Promise.all([
        // 更新我的关注数 +1
        wx.cloud.callFunction({
          name: 'update_stats',
          data: {
            collection: 'users',
            whereField: '_openid',
            whereValue: myOpenid,
            field: 'stats.following',
            amount: 1
          }
        }),
        // 更新对方的粉丝数 +1
        wx.cloud.callFunction({
          name: 'update_stats',
          data: {
            collection: 'users',
            whereField: '_openid',
            whereValue: targetOpenid,
            field: 'stats.followers',
            amount: 1
          }
        })
      ])

      if (app.globalData.userInfo && app.globalData.userInfo.stats) {
        app.globalData.userInfo.stats.following = (app.globalData.userInfo.stats.following || 0) + 1
      }

      wx.hideLoading()
      wx.showToast({
        title: '关注成功',
        icon: 'success'
      })

      const followMeRes = await db.collection('community_follows')
        .where({
          follower_id: targetOpenid,
          target_id: myOpenid
        })
        .count()

      this.setData({
        isFollowing: true,
        isMutual: followMeRes.total > 0
      })

    } catch (err) {
      console.error('关注失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    }
  },

  /**
   * 执行取消关注
   */
  async doUnfollow(targetOpenid) {
    const myOpenid = app.globalData.openid

    wx.showLoading({ title: '处理中...' })

    try {
      await db.collection('community_follows')
        .where({
          follower_id: myOpenid,
          target_id: targetOpenid
        })
        .remove()

      // 调用云函数更新双方的统计数据
      await Promise.all([
        // 更新我的关注数 -1
        wx.cloud.callFunction({
          name: 'update_stats',
          data: {
            collection: 'users',
            whereField: '_openid',
            whereValue: myOpenid,
            field: 'stats.following',
            amount: -1
          }
        }),
        // 更新对方的粉丝数 -1
        wx.cloud.callFunction({
          name: 'update_stats',
          data: {
            collection: 'users',
            whereField: '_openid',
            whereValue: targetOpenid,
            field: 'stats.followers',
            amount: -1
          }
        })
      ])

      if (app.globalData.userInfo && app.globalData.userInfo.stats) {
        app.globalData.userInfo.stats.following = Math.max(0, (app.globalData.userInfo.stats.following || 0) - 1)
      }

      wx.hideLoading()
      wx.showToast({
        title: '已取消关注',
        icon: 'success'
      })

      this.setData({
        isFollowing: false,
        isMutual: false
      })

    } catch (err) {
      console.error('取消关注失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    }
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
    this.loadPostDetail().then(() => {
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
    return {
      title: this.data.postData?.title || '非遗社区',
      path: `/pages/community/detail?id=${this.data.postId}`
    }
  }
})
