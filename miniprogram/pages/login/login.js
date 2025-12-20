// pages/login/login.js
const app = getApp()
const db = wx.cloud.database()

// 默认头像
const defaultAvatarUrl = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 用户选择的头像（临时路径或云存储路径）
    avatarUrl: defaultAvatarUrl,
    // 头像是否已选择
    avatarSelected: false,
    // 用户输入的昵称
    nickname: '',
    // 是否正在提交
    submitting: false,
    // 登录成功后重定向的页面
    redirectUrl: '',
    // 页面状态：'loading' | 'form' | 'done'
    pageState: 'loading',
    // 是否是新用户（用于显示不同的提示文字）
    isNewUser: true
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 获取重定向 URL
    if (options.redirect) {
      this.setData({
        redirectUrl: decodeURIComponent(options.redirect)
      })
    }
    
    // 检查用户是否已注册
    this.checkExistingUser()
  },

  /**
   * 检查用户是否已注册
   * 如果已注册，直接自动登录
   */
  async checkExistingUser() {
    try {
      // 1. 获取 OpenID
      let openid = app.globalData.openid
      if (!openid) {
        const res = await wx.cloud.callFunction({
          name: 'login_get_openid'
        })
        openid = res.result.openid
        app.globalData.openid = openid
      }

      if (!openid) {
        // 无法获取 OpenID，显示注册表单
        this.setData({ pageState: 'form', isNewUser: true })
        return
      }

      // 2. 查询用户是否已存在
      const userQuery = await db.collection('users')
        .where({
          _openid: openid
        })
        .get()

      if (userQuery.data && userQuery.data.length > 0) {
        // 用户已存在，直接自动登录
        const existUser = userQuery.data[0]
        app.globalData.userInfo = existUser
        
        console.log('用户已注册，自动登录成功:', existUser.nickname)
        
        wx.showToast({
          title: `欢迎回来，${existUser.nickname}`,
          icon: 'success'
        })

        // 直接返回
        setTimeout(() => {
          this.goBack()
        }, 1000)
        
        this.setData({ pageState: 'done' })
      } else {
        // 新用户，显示注册表单
        this.setData({ pageState: 'form', isNewUser: true })
      }
    } catch (err) {
      console.error('检查用户失败:', err)
      // 出错时也显示表单
      this.setData({ pageState: 'form', isNewUser: true })
    }
  },

  /**
   * 返回上一页或跳转
   */
  goBack() {
    if (this.data.redirectUrl) {
      wx.redirectTo({
        url: this.data.redirectUrl,
        fail: () => {
          wx.switchTab({
            url: this.data.redirectUrl,
            fail: () => {
              wx.navigateBack()
            }
          })
        }
      })
    } else {
      wx.navigateBack({
        fail: () => {
          wx.switchTab({
            url: '/pages/home/home'
          })
        }
      })
    }
  },

  /**
   * 选择头像回调
   * 使用微信新能力：open-type="chooseAvatar"
   */
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    console.log('选择的头像临时路径:', avatarUrl)
    
    this.setData({
      avatarUrl: avatarUrl,
      avatarSelected: true
    })
  },

  /**
   * 昵称输入回调
   * 使用微信新能力：type="nickname"
   */
  onNicknameInput(e) {
    this.setData({
      nickname: e.detail.value
    })
  },

  /**
   * 昵称输入框失焦（用于获取最终值）
   */
  onNicknameBlur(e) {
    this.setData({
      nickname: e.detail.value
    })
  },

  /**
   * 提交注册（仅新用户会调用此方法）
   */
  async onSubmit() {
    const { avatarUrl, avatarSelected, nickname, submitting } = this.data
    
    // 防止重复提交
    if (submitting) return
    
    // 验证
    if (!avatarSelected) {
      wx.showToast({
        title: '请选择头像',
        icon: 'none'
      })
      return
    }
    
    if (!nickname || nickname.trim() === '') {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      })
      return
    }
    
    this.setData({ submitting: true })
    wx.showLoading({ title: '注册中...' })
    
    try {
      // 1. 获取 OpenID（应该在 checkExistingUser 时已获取）
      let openid = app.globalData.openid
      if (!openid) {
        const res = await wx.cloud.callFunction({
          name: 'login_get_openid'
        })
        openid = res.result.openid
        app.globalData.openid = openid
      }
      
      if (!openid) {
        throw new Error('获取 OpenID 失败')
      }
      
      // 2. 上传头像到云存储
      let avatarFileId = avatarUrl
      
      // 如果是临时路径，需要上传到云存储
      if (avatarUrl.startsWith('http://tmp') || avatarUrl.startsWith('wxfile://')) {
        const timestamp = Date.now()
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${openid}_${timestamp}.jpg`,
          filePath: avatarUrl
        })
        avatarFileId = uploadRes.fileID
        console.log('头像上传成功:', avatarFileId)
      }
      
      // 3. 创建新用户记录
      const now = new Date()
      const addRes = await db.collection('users').add({
        data: {
          nickname: nickname.trim(),
          avatar_url: avatarFileId,
          is_certified: false,
          create_time: now,
          update_time: now,
          stats: {
            following: 0,
            followers: 0,
            likes: 0,
            views: 0
          }
        }
      })
      
      const userInfo = {
        _id: addRes._id,
        _openid: openid,
        nickname: nickname.trim(),
        avatar_url: avatarFileId,
        is_certified: false,
        create_time: now,
        update_time: now,
        stats: {
          following: 0,
          followers: 0,
          likes: 0,
          views: 0
        }
      }
      console.log('新用户注册成功')
      
      // 4. 保存到全局状态
      app.globalData.userInfo = userInfo
      
      // 5. 触发回调（如果有页面在监听）
      if (app.userInfoReadyCallback) {
        app.userInfoReadyCallback(userInfo)
      }
      
      wx.hideLoading()
      wx.showToast({
        title: '注册成功',
        icon: 'success'
      })
      
      // 6. 返回上一页或重定向
      setTimeout(() => {
        this.goBack()
      }, 1500)
      
    } catch (err) {
      console.error('注册失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '注册失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ submitting: false })
    }
  },

  /**
   * 跳过登录（以游客身份继续）
   */
  onSkip() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/home/home'
        })
      }
    })
  }
})

