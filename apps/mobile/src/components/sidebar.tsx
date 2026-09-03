import type { ReactNode } from "react";
import { forwardRef, memo, useCallback } from "react";
import ReanimatedDrawerLayout, {
  type DrawerLayoutMethods,
  DrawerPosition,
  DrawerType,
} from "react-native-gesture-handler/ReanimatedDrawerLayout";
import { ConversationList } from "~/features/conversations/conversation-list";
import { colors } from "~/theme/tokens";

interface SidebarProps {
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onSignOut: () => void;
  children: ReactNode;
}

/**
 * The drawer SHELL, and nothing else.
 *
 * ChatGPT-mobile style: it slides OVER the content on a left-edge swipe rather
 * than pushing it aside - hence `DrawerType.FRONT`.
 *
 * ReanimatedDrawerLayout, not a JS drawer: the gesture and the translation both
 * run on the UI thread, so the swipe cannot stutter while React is rendering a
 * transcript. That is the entire reason for the dependency.
 *
 * The contents live in `ConversationList`, which fetches its own data. That
 * split is what makes `renderNavigationView` genuinely stable: its only
 * dependencies are three callbacks the voice screen already memoises, so
 * nothing about the conversation list - a search keystroke, a refetch, a
 * rename - can reconcile the drawer through this component.
 */
const SidebarComponent = forwardRef<DrawerLayoutMethods, SidebarProps>(function Sidebar(
  { onNewChat, onSelect, onSignOut, children },
  ref,
) {
  /**
   * `useCallback`, because ReanimatedDrawerLayout takes this as a prop and
   * calls it during render. A new identity on every render reconciles the
   * ENTIRE drawer panel each time - the work a menu tap then has to wait
   * behind. The swipe never noticed, because the pan animates on the UI
   * thread without asking JS for anything.
   */
  const renderNavigationView = useCallback(
    () => (
      <ConversationList
        onNewChat={onNewChat}
        onSelect={onSelect}
        onSignOut={onSignOut}
      />
    ),
    [onNewChat, onSelect, onSignOut],
  );

  return (
    <ReanimatedDrawerLayout
      ref={ref}
      renderNavigationView={renderNavigationView}
      drawerWidth={300}
      drawerType={DrawerType.FRONT}
      drawerPosition={DrawerPosition.LEFT}
      overlayColor={colors.scrim}
      /**
       * 20dp, not 48. This is the fix for the menu button dropping presses.
       *
       * The pan claims this strip for the edge swipe, and the button sits at
       * x 8..56dp - so at 48 they overlapped almost entirely and the pan kept
       * winning the touch. Measured: 8 presses registered out of 10 taps at 48,
       * and every tap registering at 20. A swipe starts at the screen edge
       * anyway, so 20dp costs the gesture nothing - and the swipe is the part
       * that already felt right.
       */
      edgeWidth={20}
    >
      {children}
    </ReanimatedDrawerLayout>
  );
});

/**
 * Memoised, so a re-render of the voice screen does not rebuild the drawer.
 * Its props are all stabilised at the call site for exactly this reason.
 */
export const Sidebar = memo(SidebarComponent);
