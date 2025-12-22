// pages/user/relations.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command

Page({
  /**
   * 页面的初始数据
   */
  data: {
    activeTab: 0, // 0:关注 1:粉丝 2:互相关注
    tabs: ['关注', '粉丝', '互相关注'],
    followingList: [],    // 我关注的人
    followersList: [],    // 关注我的人
    mutualList: [],       // 互相关注
    loading: true,
    myOpenid: ''
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 检查登录状态
    if (!app.globalData.openid) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      wx.navigateBack()
      return
    }

    // 根据参数设置初始 tab
    if (options.tab !== undefined) {
      this.setData({
        activeTab: parseInt(options.tab)
      })
    }

    this.setData({
      myOpenid: app.globalData.openid
    })

    this.loadRelations()
  },

  /**
   * 加载关系数据
   */
  async loadRelations() {
    this.setData({ loading: true })

    try {
      const myOpenid = app.globalData.openid

      // 并行查询：我关注的人 + 关注我的人
      const [followingRes, followersRes] = await Promise.all([
        // 我关注的人
        db.collection('community_follows')
          .where({ follower_id: myOpenid })
          .orderBy('create_time', 'desc')
          .get(),
        // 关注我的人
        db.collection('community_follows')
          .where({ target_id: myOpenid })
          .orderBy('create_time', 'desc')
          .get()
      ])

      const followingRecords = followingRes.data || []
      const followersRecords = followersRes.data || []

      // 提取 openid 列表
      const followingIds = followingRecords.map(r => r.target_id)
      const followersIds = followersRecords.map(r => r.follower_id)

      // 计算互相关注（交集）
      const mutualIds = followingIds.filter(id => followersIds.includes(id))

      // 获取用户详情
      const allUserIds = [...new Set([...followingIds, ...followersIds])]
      let usersMap = {}
      
      if (allUserIds.length > 0) {
        const usersDetails = await this.getUserDetails(allUserIds)
        usersDetails.forEach(user => {
          usersMap[user._openid] = user
        })
      }

      // 构建关注列表（包含互关状态）
      const followingList = followingIds.map(id => ({
        openid: id,
        userInfo: usersMap[id] || { nickname: '用户', avatar_url: '/images/icons/avatar.png' },
        isMutual: mutualIds.includes(id)
      }))

      // 构建粉丝列表（包含是否已回关）
      const followersList = followersIds.map(id => ({
        openid: id,
        userInfo: usersMap[id] || { nickname: '用户', avatar_url: '/images/icons/avatar.png' },
        isMutual: mutualIds.includes(id)
      }))

      // 构建互相关注列表
      const mutualList = mutualIds.map(id => ({
        openid: id,
        userInfo: usersMap[id] || { nickname: '用户', avatar_url: '/images/icons/avatar.png' }
      }))

      this.setData({
        followingList,
        followersList,
        mutualList,
        loading: false
      })

      console.log('关系数据加载完成:', {
        following: followingList.length,
        followers: followersList.length,
        mutual: mutualList.length
      })

    } catch (err) {
      console.error('加载关系数据失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  /**
   * 获取用户详情
   * @param {Array} openids - openid 数组
   */
  async getUserDetails(openids) {
    if (!openids || openids.length === 0) return []

    try {
      // 云开发数据库 where in 有 100 的限制，需要分批查询
      const batchSize = 100
      const batches = []
      
      for (let i = 0; i < openids.length; i += batchSize) {
        const batch = openids.slice(i, i + batchSize)
        batches.push(batch)
      }

      const allUsers = []
      for (const batch of batches) {
        const res = await db.collection('users')
          .where({
            _openid: _.in(batch)
          })
          .field({
            _openid: true,
            nickname: true,
            avatar_url: true,
            is_certified: true,
            certified_title: true
          })
          .get()
        
        allUsers.push(...(res.data || []))
      }

      return allUsers
    } catch (err) {
      console.error('获取用户详情失败:', err)
      return []
    }
  },

  /**
   * Tab 切换
   */
  onTabChange(e) {
    const index = e.currentTarget.dataset.index
    this.setData({
      activeTab: index
    })
  },

  /**
   * 回关操作
   */
  async onFollowBack(e) {
    const targetOpenid = e.currentTarget.dataset.openid
    
    if (!app.globalData.openid) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }

    wx.showLoading({ title: '处理中...' })

    try {
      const myOpenid = app.globalData.openid

      // 添加关注记录
      await db.collection('community_follows').add({
        data: {
          follower_id: myOpenid,
          target_id: targetOpenid,
          create_time: db.serverDate()
        }
      })

      // 更新双方的统计数据
      await Promise.all([
        // 更新我的关注数 +1
        db.collection('users').where({ _openid: myOpenid }).update({
          data: {
            'stats.following': _.inc(1)
          }
        }),
        // 更新对方的粉丝数 +1
        db.collection('users').where({ _openid: targetOpenid }).update({
          data: {
            'stats.followers': _.inc(1)
          }
        })
      ])

      // 更新本地全局数据
      if (app.globalData.userInfo && app.globalData.userInfo.stats) {
        app.globalData.userInfo.stats.following = (app.globalData.userInfo.stats.following || 0) + 1
      }

      wx.hideLoading()
      wx.showToast({
        title: '回关成功',
        icon: 'success'
      })

      // 更新列表状态
      const followersList = this.data.followersList.map(item => {
        if (item.openid === targetOpenid) {
          return { ...item, isMutual: true }
        }
        return item
      })

      // 同时添加到互相关注列表
      const targetUser = followersList.find(item => item.openid === targetOpenid)
      const mutualList = [...this.data.mutualList]
      if (targetUser && !mutualList.find(m => m.openid === targetOpenid)) {
        mutualList.push({
          openid: targetOpenid,
          userInfo: targetUser.userInfo
        })
      }

      // 同时添加到关注列表
      const followingList = [...this.data.followingList]
      if (!followingList.find(f => f.openid === targetOpenid)) {
        followingList.push({
          openid: targetOpenid,
          userInfo: targetUser.userInfo,
          isMutual: true
        })
      }

      this.setData({
        followersList,
        mutualList,
        followingList
      })

    } catch (err) {
      console.error('回关失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    }
  },

  /**
   * 取消关注
   */
  onUnfollow(e) {
    const targetOpenid = e.currentTarget.dataset.openid
    const nickname = e.currentTarget.dataset.nickname || '该用户'

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
  },

  /**
   * 执行取消关注
   */
  async doUnfollow(targetOpenid) {
    if (!app.globalData.openid) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }

    wx.showLoading({ title: '处理中...' })

    try {
      const myOpenid = app.globalData.openid

      // 删除关注记录
      await db.collection('community_follows')
        .where({
          follower_id: myOpenid,
          target_id: targetOpenid
        })
        .remove()

      // 更新双方的统计数据
      await Promise.all([
        // 更新我的关注数 -1
        db.collection('users').where({ _openid: myOpenid }).update({
          data: {
            'stats.following': _.inc(-1)
          }
        }),
        // 更新对方的粉丝数 -1
        db.collection('users').where({ _openid: targetOpenid }).update({
          data: {
            'stats.followers': _.inc(-1)
          }
        })
      ])

      // 更新本地全局数据
      if (app.globalData.userInfo && app.globalData.userInfo.stats) {
        app.globalData.userInfo.stats.following = Math.max(0, (app.globalData.userInfo.stats.following || 0) - 1)
      }

      wx.hideLoading()
      wx.showToast({
        title: '已取消关注',
        icon: 'success'
      })

      // 从关注列表中移除
      const followingList = this.data.followingList.filter(item => item.openid !== targetOpenid)

      // 从互相关注列表中移除
      const mutualList = this.data.mutualList.filter(item => item.openid !== targetOpenid)

      // 更新粉丝列表中该用户的状态（如果存在的话，变为非互关）
      const followersList = this.data.followersList.map(item => {
        if (item.openid === targetOpenid) {
          return { ...item, isMutual: false }
        }
        return item
      })

      this.setData({
        followingList,
        mutualList,
        followersList
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
   * 去聊天（暂未开发）
   */
  goToChat(e) {
    const targetOpenid = e.currentTarget.dataset.openid
    wx.showToast({
      title: '私聊功能开发中',
      icon: 'none'
    })
  },

  /**
   * 查看用户主页
   */
  goToUserProfile(e) {
    const openid = e.currentTarget.dataset.openid
    // 暂时显示提示
    wx.showToast({
      title: '用户主页开发中',
      icon: 'none'
    })
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    this.loadRelations().then(() => {
      wx.stopPullDownRefresh()
    })
  }
})

