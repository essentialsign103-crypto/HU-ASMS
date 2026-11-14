// HU-ASMS: Main Menu & Navigation Keyboards
import { Keyboard, InlineKeyboard } from 'grammy';

export function getStudentMainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text('👤 My Profile').text('📚 My Academic Information').row()
    .text('📋 My Projects').text('👥 My Groups').row()
    .text('📤 Submit Assignment').text('🚀 Submit Group Project').row()
    .text('📜 Submission History').text('❓ Help & Support')
    .resized()
    .persistent();
}

export function getUnifiedMainMenuKeyboard(isRepresentative = false): Keyboard {
  const kb = new Keyboard()
    .text('👤 My Profile').text('📚 My Academic Information').row()
    .text('📋 My Projects').text('👥 My Groups').row()
    .text('📤 Submit Assignment').text('🚀 Submit Group Project').row()
    .text('📜 Submission History').text('❓ Help & Support');

  if (isRepresentative) {
    kb.row().text('⭐ Representative Operations');
  }

  return kb.resized().persistent();
}

export function getRepresentativeMainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text('🏢 My Assigned Sections').text('👥 View All Students').row()
    .text('📂 View All Projects').text('📊 Submission Reports').row()
    .text('👥 View Groups').text('📦 Forward to Teacher').row()
    .text('📜 Delivery History').text('🎓 Student Menu')
    .resized()
    .persistent();
}

export function getConfirmationInlineKeyboard(confirmAction: string, cancelAction = 'cancel'): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Confirm & Submit', confirmAction)
    .text('❌ Cancel', cancelAction);
}
