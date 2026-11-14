// HU-ASMS: Main Menu & Navigation Keyboards
import { Keyboard, InlineKeyboard } from 'grammy';

export function getStudentMainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text('📚 My Courses').text('📋 My Assignments').row()
    .text('👤 My Profile').text('👥 My Groups').row()
    .text('📤 Submit Assignment').text('🚀 Submit Group Project').row()
    .text('📜 Submission History').text('❓ Help & Support')
    .resized()
    .persistent();
}

export function getUnifiedMainMenuKeyboard(isRepresentative = false): Keyboard {
  const kb = new Keyboard()
    .text('📚 My Courses').text('📋 My Assignments').row()
    .text('👤 My Profile').text('👥 My Groups').row()
    .text('📤 Submit Assignment').text('🚀 Submit Group Project').row()
    .text('📜 Submission History').text('❓ Help & Support');

  if (isRepresentative) {
    kb.row().text('⭐ Representative Operations');
  }

  return kb.resized().persistent();
}

export function getRepresentativeMainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text('📚 My Courses').text('➕ Create Course').row()
    .text('📝 Create Assignment').text('👥 Manage Groups').row()
    .text('📥 Collect Submissions').text('📊 Submission Reports').row()
    .text('📦 Forward to Teacher').text('📜 Delivery History').row()
    .text('👥 View All Students').text('🏢 My Sections').row()
    .text('🎓 Student Menu')
    .resized()
    .persistent();
}

export function getConfirmationInlineKeyboard(confirmAction: string, cancelAction = 'cancel'): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Confirm & Submit', confirmAction)
    .text('❌ Cancel', cancelAction);
}
