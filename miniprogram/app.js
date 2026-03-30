// app.js
// 1. 将环境ID定义在最外面，确保百分百能读到
const CLOUD_ENV_ID = "xiangyunyizhen-dev-1d02h7036c82a";
const {
  normalizeUserProfile,
  getMissingUserProfilePatch
} = require('./common/user-profile')

App({
  onLaunch: function () {
    // 初始化云开发环境
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        // 2. 这里直接使用常量，不再通过 this.globalData 获取
        env: CLOUD_ENV_ID,
        traceUser: true,
      });
      
      // 静默登录检查
      this.silentLogin()
    }
  },

  setUserInfo(userInfo, { notify = true } = {}) {
    if (!userInfo) {
      this.globalData.userInfo = null
      this.globalData.userInfoVersion = Date.now()
      return null
    }

    const normalized = normalizeUserProfile(userInfo)
    this.globalData.userInfo = normalized
    this.globalData.userInfoVersion = Date.now()

    if (notify && this.userInfoReadyCallback) {
      this.userInfoReadyCallback(normalized)
    }

    return normalized
  },

  async refreshUserInfo({ syncDefaults = true, notify = true } = {}) {
    const openid = this.globalData.openid
    if (!openid) {
      this.setUserInfo(null, { notify })
      return null
    }

    const db = wx.cloud.database()
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .limit(1)
      .get()

    if (!userRes.data || !userRes.data.length) {
      this.setUserInfo(null, { notify })
      return null
    }

    const rawUser = userRes.data[0]
    const patch = syncDefaults ? getMissingUserProfilePatch(rawUser) : {}
    if (syncDefaults && Object.keys(patch).length) {
      await db.collection('users').doc(rawUser._id).update({
        data: patch
      })
    }

    const nextUser = normalizeUserProfile({
      ...rawUser,
      ...patch
    })

    return this.setUserInfo(nextUser, { notify })
  },

  /**
   * 静默登录检查
   */
  silentLogin: async function() {
    try {
      // 调用云函数获取 OpenID
      const res = await wx.cloud.callFunction({
        name: 'login_get_openid'
      })
      
      // 3. 增加容错打印，方便调试
      console.log('云函数返回结果:', res)

      const openid = res.result.openid
      if (!openid) {
        // 如果云函数调用成功但没返回 openid，说明云函数内部代码不对
        console.error('获取 OpenID 为空，请检查云函数代码')
        return
      }
      
      this.globalData.openid = openid
      console.log('当前用户 OpenID:', openid)
      
      const userInfo = await this.refreshUserInfo({ syncDefaults: true, notify: true })
      if (userInfo) {
        console.log('自动登录成功:', userInfo.nickname)
      } else {
        console.log('用户未注册，保持游客状态')
      }
    } catch (err) {
      console.error('静默登录检查失败，详细错误:', err)
      this.setUserInfo(null, { notify: false })
    }
  },

  checkLogin: function() {
    return this.globalData.userInfo !== null
  },

  requireLogin: function(redirectUrl) {
    if (this.checkLogin()) {
      return true
    }
    const url = redirectUrl 
      ? `/pages/login/login?redirect=${encodeURIComponent(redirectUrl)}`
      : '/pages/login/login'
    
    wx.navigateTo({
      url: url
    })
    return false
  },

  logout: function() {
    this.setUserInfo(null, { notify: false })
    wx.showToast({
      title: '已退出登录',
      icon: 'success'
    })
  },

  async getChatUnreadTotal() {
    const openid = this.globalData.openid
    if (!openid || !wx.cloud) return 0

    const db = wx.cloud.database()
    const countRes = await db.collection('chat_rooms')
      .where({ user_ids: openid })
      .count()

    const total = countRes.total || 0
    if (!total) return 0

    const pageSize = 20
    const batches = Math.ceil(total / pageSize)
    let unreadTotal = 0

    for (let index = 0; index < batches; index += 1) {
      const res = await db.collection('chat_rooms')
        .where({ user_ids: openid })
        .field({ unread_counts: true })
        .skip(index * pageSize)
        .limit(pageSize)
        .get()

      unreadTotal += (res.data || []).reduce((sum, item) => (
        sum + Number((item.unread_counts && item.unread_counts[openid]) || 0)
      ), 0)
    }

    return unreadTotal
  },

  async refreshChatUnreadBadge(page) {
    const unreadTotal = await this.getChatUnreadTotal().catch(() => 0)
    if (page && typeof page.getTabBar === 'function' && page.getTabBar()) {
      page.getTabBar().updateUnreadCount(unreadTotal)
    }
    return unreadTotal
  },

  globalData: {
    env: CLOUD_ENV_ID,
    openid: null,
    userInfo: null,
    userInfoVersion: 0
  }
});
