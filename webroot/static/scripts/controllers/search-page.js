/**
 * BzDeck Search Page Controller
 * Copyright © 2015 Kohei Yoshino. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

BzDeck.controllers.SearchPage = function SearchPageController (id) {
  this.id = id;

  this.data = new Proxy({
    'bugs': [],
    'preview_id': null
  },
  {
    'get': (obj, prop) => {
      if (prop === 'bugs') {
        // Return a sorted bug list
        return this.view.get_shown_bugs(new Map([for (bug of obj.bugs) [bug.id, bug]]));
      }

      return obj[prop];
    },
    'set': (obj, prop, newval) => {
      let oldval = obj[prop];

      if (oldval === newval && !this.view.preview_is_hidden) {
        return;
      }

      if (prop === 'preview_id') {
        // Show the bug preview only when the preview pane is visible (on desktop and tablet)
        if (this.view.preview_is_hidden) {
          BzDeck.router.navigate('/bug/' + newval, { 'ids': [for (bug of this.data.bugs) bug.id] });

          return; // Do not save the value
        }

        if (oldval !== newval) {
          this.prep_preview(oldval, newval);
          BzDeck.controllers.bugzfeed.subscribe([newval]);
        }
      }

      obj[prop] = newval;
    }
  });

  let params = new URLSearchParams(location.search.substr(1) || history.state ? history.state.params : undefined);

  BzDeck.views.toolbar.open_tab({
    'page_category': 'search',
    'page_id': this.id,
    'page_constructor': BzDeck.views.SearchPage,
    'page_constructor_args': [this.id, params, BzDeck.models.server.data.config, BzDeck.models.prefs.data],
    'tab_label': 'Search', // l10n
    'tab_desc': 'Search & Browse Bugs', // l10n
  }, this);

  if (params) {
    this.exec_search(params);
  }

  this.on('V:SearchRequested', data => this.exec_search(data.params));

  this.on('V:ToolbarButtonPressed', data => {
    let func = {
      'show-details': () => BzDeck.router.navigate('/bug/' + this.data.preview_id,
                                                   { 'ids': [for (bug of this.data.bugs) bug.id] }),
      'show-basic-search-pane': () => this.trigger(':ReturnToBasicSearchPane'),
    }[data.command];

    if (func) {
      func();
    }
  });
};

BzDeck.controllers.SearchPage.route = '/search/(\\d{13,})';

BzDeck.controllers.SearchPage.prototype = Object.create(BzDeck.controllers.Base.prototype);
BzDeck.controllers.SearchPage.prototype.constructor = BzDeck.controllers.SearchPage;

BzDeck.controllers.SearchPage.prototype.prep_preview = function (oldval, newval) {
  if (!newval) {
    this.trigger(':BugDataUnavailable');

    return;
  }

  BzDeck.models.bugs.get(newval).then(bug => {
    if (bug) {
      BzDeck.controllers.bugs.toggle_unread(bug.id, false);
      this.trigger(':BugDataAvailable', { bug });
    } else {
      this.trigger(':BugDataUnavailable');
    }
  });
};

BzDeck.controllers.SearchPage.prototype.exec_search = function (params) {
  if (!navigator.onLine) {
    this.trigger(':Offline');

    return;
  }

  this.trigger(':SearchStarted');

  this.request('GET', 'bug', params).then(result => {
    if (result.bugs.length > 0) {
      this.data.bugs = result.bugs;

      // Save data
      BzDeck.models.bugs.get_all().then(bugs => {
        let saved_ids = [for (bug of bugs) bug.id];

        BzDeck.models.bugs.save([for (bug of result.bugs) if (!saved_ids.includes(bug.id)) bug]);
      });
    }

    // Show results
    this.trigger(':SearchResultsAvailable', { 'bugs': result.bugs });
  }).catch(error => {
    this.trigger(':SearchError', { error });
  }).then(() => {
    this.trigger(':SearchComplete');
  });
};
