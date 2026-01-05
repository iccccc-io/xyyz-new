// 云函数入口文件 - 清除聊天未读数
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

/**
 * 清除聊天未读数
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.room_id - 会话房间ID
 * 
 * @returns {Object} { success: Boolean, message: String }
 */
exports.main = async (event, context) => {
  const { room_id } = event
  
  // 获取调用者 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!room_id) {
    return {
      success: false,
      message: '参数错误：缺少 room_id'
    }
  }

  try {
    // 将当前用户的未读数设为 0
    await db.collection('chat_rooms').doc(room_id).update({
      data: {
        [`unread_counts.${openid}`]: 0
      }
    })

    console.log('[清除未读] 成功:', { room_id, openid })

    return {
      success: true,
      message: '清除成功'
    }
  } catch (err) {
    // 房间可能不存在，这是正常情况
    console.log('[清除未读] 房间不存在或更新失败:', err.message)
    return {
      success: true,
      message: '无需清除'
    }
  }
}

