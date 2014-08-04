/**
 * BzDeck Home Page
 * Copyright © 2014 Kohei Yoshino. All rights reserved.
 */

'use strict';

let BzDeck = BzDeck || {};

BzDeck.HomePage = function () {
  let FTw = FlareTail.widget,
      mobile = FlareTail.util.device.type.startsWith('mobile'),
      prefs = BzDeck.model.data.prefs;

  // A movable splitter between the thread pane and preview pane
  {
    let splitter = this.preview_splitter
                 = new FTw.Splitter(document.querySelector('#home-preview-splitter')),
        prefix = 'ui.home.preview.splitter.position.',
        pref = prefs[prefix + splitter.data.orientation];

    if (pref) {
      splitter.data.position = pref;
    }

    splitter.bind('Resized', event => {
      let position = event.detail.position;

      if (position) {
        prefs[prefix + splitter.data.orientation] = position;
      }
    });
  }

  let $bug = document.querySelector('#home-preview-pane article'),
      $info = document.querySelector('#preview-bug-info').content.cloneNode(true).firstElementChild;

  $bug.appendChild($info).id = 'home-preview-bug-info';

  // Star on the header
  let $star_button = document.querySelector('#home-preview-bug header [role="button"][data-command="star"]');

  (new FTw.Button($star_button)).bind('Pressed', event =>
    BzDeck.core.toggle_star(this.data.preview_id, event.detail.pressed));

  // Custom scrollbar (info)
  new FTw.ScrollBar($info);

  // Custom scrollbar (timeline)
  let scrollbar = new FTw.ScrollBar(document.querySelector('#home-preview-bug-timeline'));

  if (scrollbar) {
    scrollbar.onkeydown_extend = BzDeck.bug.timeline.handle_keydown.bind(scrollbar);
  }

  this.view = {};

  let prefs = BzDeck.model.data.prefs,
      layout_pref = prefs['ui.home.layout'],
      vertical = mobile || !layout_pref || layout_pref === 'vertical';

  this.thread = new BzDeck.Thread(this, 'home', document.querySelector('#home-list'), {
    'date': { 'simple': vertical },
    'sortable': true,
    'reorderable': true,
    'sort_conditions': vertical ? { 'key': 'last_change_time', 'order': 'descending' }
                                : prefs['home.list.sort_conditions'] ||
                                  { 'key': 'id', 'order': 'ascending' }
  });

  this.change_layout(prefs['ui.home.layout']);

  let grid = this.thread.grid;

  grid.bind('Rebuilt', event => {
    // Select the first bug on the list automatically when a folder is opened
    // TODO: Remember the last selected bug for each folder
    if (grid.data.rows.length && !mobile) {
      grid.view.selected = grid.view.focused = grid.view.members[0];
    }
  });

  // Show Details button
  let $button = document.querySelector('#home-preview-bug [data-command="show-details"]'),
      button = this.view.details_button = new FlareTail.widget.Button($button);

  button.bind('Pressed', event => {
    BzDeck.detailspage = new BzDeck.DetailsPage(this.data.preview_id, this.data.bug_list);
  });

  this.data = new Proxy({
    'bug_list': [],
    'preview_id': null
  },
  {
    'get': (obj, prop) => {
      if (prop === 'bug_list') {
        // Return a sorted bug list
        let bugs = {};

        for (let bug of obj[prop]) {
          bugs[bug.id] = bug;
        }

        return [for (row of grid.data.rows) bugs[row.data.id]];
      }

      return obj[prop];
    },
    'set': (obj, prop, newval) => {
      let oldval = obj[prop];

      if (prop === 'preview_id' && oldval !== newval) {
        FlareTail.util.event.async(() => {
          this.show_preview(oldval, newval);
        });

        BzDeck.bugzfeed.subscribe([newval]);
      }

      obj[prop] = newval;
    }
  });

  window.addEventListener('UI:toggle_star', event => {
    let _bug = event.detail.bug,
        _starred = _bug._starred_comments;

    if (this.data.preview_id === _bug.id) {
      document.querySelector('#home-preview-bug [role="button"][data-command="star"]')
              .setAttribute('aria-pressed', !!_starred.size);

      for (let $comment of document.querySelectorAll('#home-preview-bug [itemprop="comment"][data-id]')) {
        $comment.querySelector('[role="button"][data-command="star"]')
                .setAttribute('aria-pressed', _starred.has(Number.parseInt($comment.dataset.id)));
      }
    }
  });

  window.addEventListener('bug:updated', event => {
    if (this.data.preview_id === event.detail.bug.id) {
      BzDeck.bug.update(document.querySelector('#home-preview-bug'),
                        event.detail.bug, event.detail.changes);
    }
  });
};

BzDeck.HomePage.prototype.show_preview = function (oldval, newval) {
  let $pane = document.querySelector('#home-preview-pane'),
      $bug = document.querySelector('#home-preview-bug'),
      button = this.view.details_button;

  // Remove the current preview if exists

  if (!newval) {
    $bug.setAttribute('aria-hidden', 'true');
    button.data.disabled = true;

    return;
  }

  BzDeck.model.get_bug_by_id(newval).then(bug => {
    if (!bug) {
      $bug.setAttribute('aria-hidden', 'true');
      button.data.disabled = true;

      return;
    }

    // Fill the content
    BzDeck.bug.fill_data($bug, bug);
    BzDeck.core.toggle_unread(bug.id, false);
    $bug.setAttribute('aria-hidden', 'false');
    button.data.disabled = false;
  });
};

BzDeck.HomePage.prototype.change_layout = function (pref, sort_grid = false) {
  let vertical = FlareTail.util.device.type.startsWith('mobile') || !pref || pref === 'vertical',
      grid = this.thread.grid,
      splitter = this.preview_splitter;

  document.documentElement.setAttribute('data-home-layout', vertical ? 'vertical' : 'classic');
  grid.options.adjust_scrollbar = !vertical;
  grid.options.date.simple = vertical;

  // Change the date format on the thread pane
  for (let $time of grid.view.$container.querySelectorAll('time')) {
    $time.textContent = FlareTail.util.datetime.format($time.dateTime, { 'simple': vertical });
    $time.dataset.simple = vertical;
  }

  if (splitter) {
    let orientation = vertical ? 'vertical' : 'horizontal',
        pref = BzDeck.model.data.prefs[`ui.home.preview.splitter.position.${orientation}`];

    splitter.data.orientation = orientation;

    if (pref) {
      splitter.data.position = pref;
    }
  }

  if (vertical && sort_grid) {
    // Force to change the sort condition when switched to the mobile layout
    let cond = grid.options.sort_conditions;

    cond.key = 'last_change_time';
    cond.order = 'descending';
  }
};

BzDeck.HomePage.prototype.change_window_title = function (title) {
  document.title = title;
  document.querySelector('[role="banner"] h1').textContent = title;
  document.querySelector('#tab-home').title = title;
  document.querySelector('#tab-home label').textContent = title;
  document.querySelector('#tabpanel-home h2').textContent = title;
};
