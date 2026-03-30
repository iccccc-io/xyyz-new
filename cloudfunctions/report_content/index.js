// 云函数入口文件 - 举报内容
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const { type, target_type, target_id, room_id, reason } = event || {}
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const finalTargetType = target_type || type
  const finalTargetId = target_id || room_id

  if (!openid) {
    return fail('请先登录')
  }

  if (!finalTargetType || !finalTargetId) {
    return fail('举报参数缺失')
  }

  if (!['chat_message', 'chat_room'].includes(finalTargetType)) {
    return fail('暂不支持的举报类型')
  }

  try {
    const existRes = await db.collection('community_reports')
      .where({
        target_id: finalTargetId,
        target_type: finalTargetType,
        reporter_id: openid
      })
      .count()

    if (existRes.total > 0) {
      return fail('您已举报过该内容')
    }

    const recentContext = room_id
      ? await getRecentChatContext(room_id)
      : []

    await db.collection('community_reports').add({
      data: {
        target_id: finalTargetId,
        target_type: finalTargetType,
        room_id: room_id || '',
        reason: reason || 'other',
        reporter_id: openid,
        create_time: db.serverDate(),
        status: 'pending',
        recent_context: recentContext
      }
    })

    return {
      success: true,
      message: '举报成功，感谢反馈'
    }
  } catch (err) {
    console.error('[report_content] 举报失败:', err)
    return fail(err.message || '举报失败')
  }
}

function fail(message) {
  return {
    success: false,
    message
  }
}

async function getRecentChatContext(roomId) {
  const res = await db.collection('chat_messages')
    .where({
      room_id: roomId,
      is_revoked: false
    })
    .orderBy('send_time', 'desc')
    .limit(3)
    .get()

  return (res.data || [])
    .reverse()
    .map((item) => ({
      msg_id: item._id,
      sender_id: item.sender_id || '',
      msg_type: item.msg_type || 'text',
      content: item.msg_type === 'image'
        ? '[图片]'
        : String(item.content || '').slice(0, 100),
      send_time: item.send_time || null
    }))
}
