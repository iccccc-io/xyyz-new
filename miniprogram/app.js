// app.js
// 1. 将环境ID定义在最外面，确保百分百能读到
const CLOUD_ENV_ID = "xiangyunyizhen-dev-1d02h7036c82a";

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
      
      // 查询数据库
      const db = wx.cloud.database()
      const userRes = await db.collection('users')
        .where({
          _openid: openid
        })
        .get()
      
      if (userRes.data && userRes.data.length > 0) {
        const userInfo = userRes.data[0]
        this.globalData.userInfo = userInfo
        console.log('自动登录成功:', userInfo.nickname)
        
        if (this.userInfoReadyCallback) {
          this.userInfoReadyCallback(userInfo)
        }
      } else {
        this.globalData.userInfo = null
        console.log('用户未注册，保持游客状态')
      }
    } catch (err) {
      console.error('静默登录检查失败，详细错误:', err)
      this.globalData.userInfo = null
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
    this.globalData.userInfo = null
    wx.showToast({
      title: '已退出登录',
      icon: 'success'
    })
  },

  globalData: {
    env: CLOUD_ENV_ID,
    openid: null,
    userInfo: null
  }
});