import videojs from 'video.js';

const Button = videojs.getComponent('Button');
const Component = videojs.getComponent('Component');

/**
 * Toggle fullscreen video
 *
 * @extends Button
 */
class GroupPlayButton extends Button {

  /**
   * Creates an instance of this class.
   *
   * @param {Player} player
   *        The `Player` that this class should be attached to.
   *
   * @param {Object} [options]
   *        The key/value store of player options.
   */
  constructor(player, options) {
    super(player, options);

    this.handleGroupPlayChange = this.handleGroupPlayChange.bind(this);

    // set initial state;

    this.player_.on('group-play-change', this.handleGroupPlayChange);
  }

  /**
   * Builds the default DOM `className`.
   *
   * @return {string}
   *         The DOM `className` for this object.
   */
  buildCSSClass() {
    return `vjs-group-play-button ${super.buildCSSClass()}`;
  }

  /**
   * Handles fullscreenchange on the player and change control text accordingly.
   *
   * @param {EventTarget~Event} [event]
   *        The {@link Player#fullscreenchange} event that caused this function to be
   *        called.
   *
   * @listens Player#fullscreenchange
   */
  handleGroupPlayChange(event) {
    if (this.player_.groupPlay().isSetup_) {
      this.controlText('Stop Group Sharing');
    } else {
      this.controlText('Start Group Sharing');
    }
  }

  /**
   * This gets called when an `FullscreenToggle` is "clicked". See
   * {@link ClickableComponent} for more detailed information on what a click can be.
   *
   * @param {EventTarget~Event} [event]
   *        The `keydown`, `tap`, or `click` event that caused this function to be
   *        called.
   *
   * @listens tap
   * @listens click
   */
  handleClick(event) {
    if (this.player_.groupPlay().isSetup_) {
      this.player_.groupPlay().reset();
    } else {
      this.player_.groupPlay().setup();
    }
  }

}

/**
 * The text that should display over the `FullscreenToggle`s controls. Added for localization.
 *
 * @type {string}
 * @private
 */
GroupPlayButton.prototype.controlText_ = 'Group Playback Sharing';

Component.registerComponent('GroupPlayButton', GroupPlayButton);
export default GroupPlayButton;
