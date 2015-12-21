/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Initialize the Quick Search Controller that controls the Quick Search functionality on the application header.
 *
 * @constructor
 * @extends BaseController
 * @argument {undefined}
 * @return {Object} controller - New QuickSearchController instance.
 */
BzDeck.controllers.QuickSearch = function QuickSearchController () {
  BzDeck.views.quick_search = new BzDeck.views.QuickSearch();

  this.on('V:RecentSearchesRequested', data => this.provide_recent_searches());
  this.on('V:QuickSearchRequested', data => this.exec_quick_search(data.input));
  this.on('V:AdvancedSearchRequested', data => this.exec_advanced_search(data.input));
  this.subscribe('V:ResultSelected');
};

BzDeck.controllers.QuickSearch.prototype = Object.create(BzDeck.controllers.Base.prototype);
BzDeck.controllers.QuickSearch.prototype.constructor = BzDeck.controllers.QuickSearch;

/**
 * Provide recent searches done by the user. Notify the results with an event.
 *
 * @argument {undefined}
 * @return {Boolean} provided - Whether the results are provided.
 */
BzDeck.controllers.QuickSearch.prototype.provide_recent_searches = function () {
  let history = BzDeck.prefs.get('search.quick.history') || [],
      results = [];

  for (let item of history) {
    let { type, id } = item;

    if (type === 'bug') {
      let bug = BzDeck.collections.bugs.get(id);

      if (bug) {
        results.push(this.get_bug_result(bug));
      }
    }

    if (type === 'user') {
      let user = BzDeck.collections.users.get(id);

      if (user) {
        results.push(this.get_user_result(user));
      }
    }
  }

  if (!results.length) {
    return false;
  }

  this.trigger(':ResultsAvailable', { category: 'recent', input: '', results });

  return true;
};

/**
 * Execute a quick search and notify the results with an event. TODO: Add support for other objects like products and
 * components (#326).
 *
 * @argument {String} input - Original search terms, may contain spaces.
 * @return {undefined}
 */
BzDeck.controllers.QuickSearch.prototype.exec_quick_search = function (input) {
  input = input.trim();

  if (!input) {
    return;
  }

  let params_bugs = new URLSearchParams(),
      params_users = new URLSearchParams();

  let return_bugs = bugs => this.trigger(':ResultsAvailable', {
    category: 'bugs',
    input,
    results: bugs.map(bug => this.get_bug_result(bug)),
  });

  let return_users = users => this.trigger(':ResultsAvailable', {
    category: 'users',
    input,
    results: users.map(user => this.get_user_result(user)),
  });

  params_bugs.append('short_desc', input);
  params_bugs.append('short_desc_type', 'allwordssubstr');
  params_bugs.append('resolution', '---'); // Search only open bugs
  BzDeck.collections.bugs.search_local(params_bugs).then(bugs => return_bugs(bugs));

  params_users.append('match', input);
  params_users.append('limit', 10);
  BzDeck.collections.users.search_local(params_users).then(users => return_users(users));

  // Remote searches require at learst 3 characters
  if (input.length >= 3) {
    // Use a .5 second timer not to send requests so frequently while the user is typing
    window.clearTimeout(this.searchers);
    this.searchers = window.setTimeout(() => {
      BzDeck.collections.bugs.search_remote(params_bugs).then(bugs => return_bugs(bugs));
      BzDeck.collections.users.search_remote(params_users).then(users => return_users(users));
    }, 500);
  }
};

/**
 * Extract some bug properties for a quick search result.
 *
 * @argument {Proxy} bug - BugModel instance.
 * @return {Object} result - Bug search result.
 */
BzDeck.controllers.QuickSearch.prototype.get_bug_result = function (bug) {
  let contributor = bug.comments ? bug.comments[bug.comments.length - 1].creator : bug.creator;

  return {
    type: 'bug',
    id: bug.id,
    summary: bug.summary,
    last_change_time: bug.last_change_time,
    contributor: BzDeck.collections.users.get(contributor, { name: contributor }).properties,
  };
};

/**
 * Extract some user properties for a quick search result.
 *
 * @argument {Proxy} user - UserModel instance.
 * @return {Object} result - User search result.
 */
BzDeck.controllers.QuickSearch.prototype.get_user_result = function (user) {
  return Object.assign({ type: 'user', id: user.email }, user.properties);
};

/**
 * Execute an advanced search by opening a new search page.
 *
 * @argument {String} input - Original search terms, may contain spaces.
 * @return {undefined}
 */
BzDeck.controllers.QuickSearch.prototype.exec_advanced_search = function (input) {
  let params = new URLSearchParams();

  if (input.trim()) {
    params.append('short_desc', input.trim());
    params.append('short_desc_type', 'allwordssubstr');
    params.append('resolution', '---'); // Search only open bugs
  }

  BzDeck.router.navigate(`/search/${Date.now()}`, { 'params' : params.toString() });
};

/**
 * Called by QuickSearchView whenever a search result is selected. Show the result in a new tab, and update the search
 * history.
 *
 * @argument {Object} data - Passed data.
 * @argument {{String|Number)} data.id - Item name, such as bug ID or user name.
 * @argument {String} data.type - Item type, such as 'bug' or 'user'.
 * @return {undefined}
 */
BzDeck.controllers.QuickSearch.prototype.on_result_selected = function (data) {
  let { id, type } = data,
      history = BzDeck.prefs.get('search.quick.history') || [],
      // Find an existing item
      index = history.findIndex(item => item.type === type && item.id === id),
      // If the history has the same item, update the timestamp and reorder the history. Otherwise, create a new object
      item = index > -1 ? history.splice(index, 1)[0] : { type, id };

  BzDeck.router.navigate(`/${type.replace('user', 'profile')}/${id}`);

  item.timestamp = Date.now();
  history.unshift(item);
  history.length = 25; // Max quick history items
  BzDeck.prefs.set('search.quick.history', history);
};