// 云函数入口文件 - 帖子管理
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

/**
 * 帖子管理云函数
 * 用于：权限设置、评论开关、置顶
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.postId - 帖子 ID
 * @param {String} event.action - 操作类型：'privacy' | 'comment_toggle' | 'top'
 * @param {Any} event.value - 新值
 * 
 * @returns {Object} { success: Boolean, message: String }
 */
exports.main = async (event, context) => {
  const { postId, action, value } = event
  
  // 获取调用者 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // ========== 参数校验 ==========
  if (!postId || !action) {
    return {
      success: false,
      message: '参数错误：缺少必要参数'
    }
  }

  const allowedActions = ['privacy', 'comment_toggle', 'top']
  if (!allowedActions.includes(action)) {
    return {
      success: false,
      message: '参数错误：不支持的操作类型'
    }
  }

  try {
    // ========== 1. 查询帖子并校验权限 ==========
    const postRes = await db.collection('community_posts').doc(postId).get()
    
    if (!postRes.data) {
      return {
        success: false,
        message: '帖子不存在'
      }
    }

    const post = postRes.data

    // 权限校验：只有作者可以操作
    if (post._openid !== openid) {
      console.warn(`[安全警告] 用户 ${openid} 尝试操作他人帖子 ${postId}`)
      return {
        success: false,
        message: '无权操作他人帖子'
      }
    }

    // ========== 2. 根据 action 执行不同操作 ==========
    let updateData = {}
    let logMessage = ''

    switch (action) {
      case 'privacy':
        // 权限设置：0=公开，1=私密
        if (value !== 0 && value !== 1) {
          return {
            success: false,
            message: '参数错误：status 值无效'
          }
        }
        updateData.status = value
        logMessage = value === 1 ? '设为私密' : '设为公开'
        break

      case 'comment_toggle':
        // 评论开关
        if (typeof value !== 'boolean') {
          return {
            success: false,
            message: '参数错误：comment_status 值无效'
          }
        }
        updateData.comment_status = value
        logMessage = value ? '开启评论' : '关闭评论'
        break

      case 'top':
        // 置顶
        if (typeof value !== 'boolean') {
          return {
            success: false,
            message: '参数错误：is_top 值无效'
          }
        }
        updateData.is_top = value
        logMessage = value ? '置顶' : '取消置顶'
        break
    }

    // ========== 3. 执行更新 ==========
    updateData.update_time = db.serverDate()
    
    await db.collection('community_posts').doc(postId).update({
      data: updateData
    })

    console.log(`[帖子管理] 用户 ${openid} 对帖子 ${postId} 执行了「${logMessage}」操作`)

    return {
      success: true,
      message: '操作成功'
    }

  } catch (err) {
    console.error('[帖子管理失败]', err)
    return {
      success: false,
      message: `操作失败: ${err.message || '未知错误'}`
    }
  }
}

