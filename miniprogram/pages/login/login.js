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
    redirectUrl: ''
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
   * 提交登录/注册
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
    wx.showLoading({ title: '登录中...' })
    
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
      
      // 3. 查询用户是否已存在
      const userQuery = await db.collection('users')
        .where({
          _openid: openid
        })
        .get()
      
      let userInfo
      const now = new Date()
      
      if (userQuery.data && userQuery.data.length > 0) {
        // 4a. 用户已存在，更新信息
        const existUser = userQuery.data[0]
        await db.collection('users').doc(existUser._id).update({
          data: {
            nickname: nickname.trim(),
            avatar_url: avatarFileId,
            update_time: now
          }
        })
        
        userInfo = {
          ...existUser,
          nickname: nickname.trim(),
          avatar_url: avatarFileId,
          update_time: now
        }
        console.log('用户信息更新成功')
      } else {
        // 4b. 新用户，创建记录
        // 注意：_openid 是系统字段，会自动填充，不能手动指定
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
        
        userInfo = {
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
      }
      
      // 5. 保存到全局状态
      app.globalData.userInfo = userInfo
      
      // 6. 触发回调（如果有页面在监听）
      if (app.userInfoReadyCallback) {
        app.userInfoReadyCallback(userInfo)
      }
      
      wx.hideLoading()
      wx.showToast({
        title: '登录成功',
        icon: 'success'
      })
      
      // 7. 返回上一页或重定向
      setTimeout(() => {
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
              // 如果无法返回，跳转到首页
              wx.switchTab({
                url: '/pages/home/home'
              })
            }
          })
        }
      }, 1500)
      
    } catch (err) {
      console.error('登录失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '登录失败，请重试',
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

