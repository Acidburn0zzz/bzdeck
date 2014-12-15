/**
 * BzDeck Thread Panes
 * Copyright © 2014 Kohei Yoshino. All rights reserved.
 */

'use strict';

let BzDeck = BzDeck || {};

BzDeck.Thread = function Thread () {};

BzDeck.Thread.prototype.onselect = function (event) {
  let ids = event.detail.ids;

  if (!ids.length) {
    return;
  }

  // Show Bug in Preview Pane
  let id = this.consumer.data.preview_id = Number.parseInt(ids[ids.length - 1]);

  // Mobile compact layout
  if (FlareTail.util.device.type === 'mobile-phone') {
    BzDeck.router.navigate('/bug/' + id, { 'ids': [for (bug of this.consumer.data.bugs) bug.id] });
  }
};

BzDeck.Thread.prototype.ondblclick = function (event, selector) {
  let $target = event.originalTarget;

  if ($target.matches(selector)) {
    // Open Bug in New Tab
    BzDeck.router.navigate('/bug/' + $target.dataset.id, { 'ids': [for (bug of this.consumer.data.bugs) bug.id] });
  }
};

/* ------------------------------------------------------------------------------------------------------------------
 * Classic Thread
 * ------------------------------------------------------------------------------------------------------------------ */

BzDeck.ClassicThread = function ClassicThread (consumer, name, $grid, options) {
  let prefs = BzDeck.model.data.prefs,
      default_cols = BzDeck.config.grid.default_columns,
      columns = prefs[`${name}.list.columns`] || default_cols,
      field = BzDeck.model.data.server.config.field;

  this.consumer = consumer;
  this.bugs = [];

  this.$$grid = new FlareTail.widget.Grid($grid, {
    'rows': [],
    'columns': columns.map(col => {
      // Add labels
      col.label = [for (_col of default_cols) if (_col.id === col.id) _col.label][0] ||
                  field[col.id].description;

      return col;
    })
  }, options);

  this.$$grid.bind('Selected', event => this.onselect(event));
  this.$$grid.bind('dblclick', event => this.ondblclick(event, '[role="row"]'));
  this.$$grid.bind('Sorted', event => prefs[`${name}.list.sort_conditions`] = event.detail.conditions);

  this.$$grid.bind('ColumnModified', event => {
    prefs[`${name}.list.columns`] = event.detail.columns.map(col => ({
      'id': col.id,
      'type': col.type || 'string',
      'hidden': col.hidden || false
    }));
  });

  this.$$grid.bind('keydown', event => {
    let modifiers = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey,
        data = this.$$grid.data,
        selected = this.$$grid.view.selected;

    // [M] toggle read
    if (!modifiers && event.keyCode === event.DOM_VK_M) {
      for (let $item of selected) {
        let _data = data.rows[$item.sectionRowIndex].data;

        _data._unread = _data._unread !== true;
      }
    }

    // [S] toggle star
    if (!modifiers && event.keyCode === event.DOM_VK_S) {
      for (let $item of selected) {
        let _data = data.rows[$item.sectionRowIndex].data;

        _data._starred = _data._starred !== true;
      }
    }
  }, true); // use capture

  window.addEventListener('Bug:StarToggled', event => {
    let bug = event.detail.bug,
        $row = $grid.querySelector(`[role="row"][data-id="${bug.id}"]`);

    if ($row) {
      $row.querySelector('[data-id="_starred"] [role="checkbox"]')
          .setAttribute('aria-checked', !!bug._starred_comments.size);
    }
  });

  window.addEventListener('Bug:UnreadToggled', event => {
    let bug = event.detail.bug,
        $row = $grid.querySelector(`[role="row"][data-id="${bug.id}"]`);

    if ($row) {
      $row.setAttribute('data-unread', !!bug._unread);
    }
  });
};

BzDeck.ClassicThread.prototype = Object.create(BzDeck.Thread.prototype);

BzDeck.ClassicThread.prototype.constructor = BzDeck.ClassicThread;

BzDeck.ClassicThread.prototype.update = function (bugs) {
  this.bugs = bugs;

  this.$$grid.build_body(bugs.map(bug => {
    let row = {
      'id': `${this.$$grid.view.$container.id}-row-${bug.id}`,
      'data': {},
      'dataset': {
        'unread': bug._unread === true,
        'severity': bug.severity
      }
    };

    for (let column of this.$$grid.data.columns) {
      let field = column.id,
          value = bug[field];

      if (!value) {
        value = '';
      }

      if (Array.isArray(value)) {
        if (field === 'mentors') { // Array of Person
          value = [for (person of bug['mentors_detail']) BzDeck.core.get_name(person)].join(', ');
        } else { // Keywords
          value = value.join(', ');
        }
      }

      if (typeof value === 'object' && !Array.isArray(value)) { // Person
        value = BzDeck.core.get_name(bug[`${field}_detail`]);
      }

      if (field === '_starred') {
        value = BzDeck.model.bug_is_starred(bug);
      }

      if (field === '_unread') {
        value = value === true;
      }

      row.data[field] = value;
    }

    row.data = new Proxy(row.data, {
      'set': (obj, prop, value) => {
        if (prop === '_starred') {
          BzDeck.core.toggle_star(obj.id, value);
        }

        if (prop === '_unread') {
          BzDeck.core.toggle_unread(obj.id, value);

          let row = [for (row of this.$$grid.data.rows) if (row.data.id === obj.id) row][0];

          if (row && row.$element) {
            row.$element.dataset.unread = value;
          }
        }

        obj[prop] = value;
      }
    });

    return row;
  }));
};

BzDeck.ClassicThread.prototype.filter = function (bugs) {
  this.$$grid.filter([for (bug of bugs) bug.id]);
};

/* ------------------------------------------------------------------------------------------------------------------
 * Vertical Thread
 * ------------------------------------------------------------------------------------------------------------------ */

BzDeck.VerticalThread = function VerticalThread (consumer, name, $outer, options) {
  let mobile = FlareTail.util.device.type.startsWith('mobile');

  this.consumer = consumer;
  this.name = name;
  this.options = options;

  this.$outer = $outer;
  this.$listbox = $outer.querySelector('[role="listbox"]');
  this.$$listbox = new FlareTail.widget.ListBox(this.$listbox, []);
  this.$option = FlareTail.util.content.get_fragment('vertical-thread-item').firstElementChild;
  this.$$scrollbar = new FlareTail.widget.ScrollBar($outer);
  this.$scrollable_area = mobile ? $outer.querySelector('.scrollable-area-content') : $outer;

  this.$$listbox.bind('Selected', event => this.onselect(event));
  this.$$listbox.bind('dblclick', event => this.ondblclick(event, '[role="option"]'));

  this.$$listbox.bind('keydown', event => {
    let modifiers = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey,
        selected = this.$$listbox.view.selected;

    // [S] toggle star
    if (!modifiers && event.keyCode === event.DOM_VK_S) {
      for (let $item of selected) {
        BzDeck.core.toggle_star(Number($item.dataset.id), $item.querySelector('[data-field="_starred"]')
                                                               .getAttribute('aria-checked') === 'false');
      }
    }

    // [M] toggle read
    if (!modifiers && event.keyCode === event.DOM_VK_M) {
      for (let $item of selected) {
        BzDeck.core.toggle_unread(Number($item.dataset.id), $item.dataset.unread === 'false');
      }
    }
  }, true); // use capture

  window.addEventListener('Bug:StarToggled', event => {
    let bug = event.detail.bug,
        $option = this.$listbox.querySelector(`[role="option"][data-id="${bug.id}"]`);

    if ($option) {
      $option.querySelector('[data-field="_starred"]').setAttribute('aria-checked', !!bug._starred_comments.size);
    }
  });

  window.addEventListener('Bug:UnreadToggled', event => {
    let bug = event.detail.bug,
        $option = this.$listbox.querySelector(`[role="option"][data-id="${bug.id}"]`);

    if ($option) {
      $option.setAttribute('data-unread', !!bug._unread);
    }
  });

  // Lazy loading while scrolling
  this.$scrollable_area.addEventListener('scroll', event => {
    if (this.unrendered_bugs.length && event.target.scrollTop === event.target.scrollTopMax) {
      FlareTail.util.event.async(() => this.render());
    }
  });
};

BzDeck.VerticalThread.prototype = Object.create(BzDeck.Thread.prototype);

BzDeck.VerticalThread.prototype.constructor = BzDeck.VerticalThread;

BzDeck.VerticalThread.prototype.update = function (bugs) {
  let cond = this.options.sort_conditions;

  if (cond) {
    FlareTail.util.array.sort(bugs, cond);
  }

  this.unrendered_bugs = bugs;
  this.$outer.setAttribute('aria-busy', 'true');
  this.$listbox.innerHTML = '';

  FlareTail.util.event.async(() => {
    this.render();
    this.$listbox.dispatchEvent(new CustomEvent('Updated'));
    this.$outer.removeAttribute('aria-busy');
    this.$scrollable_area.scrollTop = 0;
  });
};

BzDeck.VerticalThread.prototype.render = function () {
  let $fragment = new DocumentFragment();

  for (let bug of this.unrendered_bugs.splice(0, 50)) {
    let $option = $fragment.appendChild(FlareTail.util.content.fill(this.$option.cloneNode(true), {
      'id': bug.id,
      'name': bug.summary,
      'dateModified': bug.last_change_time,
    }, {
      'id': `${this.name}-vertical-thread-bug-${bug.id}`,
      'data-id': bug.id,
      'data-unread': !!bug._unread,
      'aria-checked': BzDeck.model.bug_is_starred(bug)
    }));

    BzDeck.core.set_avatar(bug.creator_detail, $option.querySelector('img'));
  }

  this.$listbox.appendChild($fragment);
  this.$listbox.dispatchEvent(new CustomEvent('Rendered'));
  this.$$listbox.update_members();
  this.$$scrollbar.set_height();
};
