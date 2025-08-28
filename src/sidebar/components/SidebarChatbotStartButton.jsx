import { selectedSidebarChatbot } from '#stores/sidebarStore';
import config from '@plone/registry';
import { DefaultChatbotStartButton } from './DefaultChatbotStartButton';

export function SidebarChatbotStartButton({
  block,
  title = 'Start assistant chat',
}) {
  const ChatbotStartButton =
    config.getComponent('ChatbotStartButton')?.component ||
    DefaultChatbotStartButton;

  // TODO: Hide the start button until we've checked we support the dialog element and JS is loaded
  return (
    <div className="block danswerChat">
      <ChatbotStartButton
        onClick={() => {
          selectedSidebarChatbot.set(block);
        }}
        title={title || 'Start assistant chat'}
      />
    </div>
  );
}
