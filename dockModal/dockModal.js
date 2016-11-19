(function() {
  'use strict';

  angular.module('dockModal', []);

  angular
    .module('dockModal')
    .service('$mdCompiler', MdCompilerService)
    .factory('$dockModal', dockModalProvider);

  MdCompilerService.$inject = [
   '$q',
   '$templateRequest', 
   '$injector', 
   '$compile',
   '$controller'
  ];

  function MdCompilerService($q, $templateRequest, $injector, $compile, $controller) {
    /** @private @const {!angular.$q} */
    this.$q = $q;

    /** @private @const {!angular.$templateRequest} */
    this.$templateRequest = $templateRequest;

    /** @private @const {!angular.$injector} */
    this.$injector = $injector;

    /** @private @const {!angular.$compile} */
    this.$compile = $compile;

    /** @private @const {!angular.$controller} */
    this.$controller = $controller;
  }

  MdCompilerService.prototype.compile = function(options) {

    if (options.contentElement) {
      return this._prepareContentElement(options);
    } else {
      return this._compileTemplate(options);
    }

  };

  MdCompilerService.prototype._fetchContentElement = function(options) {

    var contentEl = options.contentElement;
    var restoreFn = null;

    if (angular.isString(contentEl)) {
      contentEl = document.querySelector(contentEl);
      restoreFn = createRestoreFn(contentEl);
    } else {
      contentEl = contentEl[0] || contentEl;

      // When the element is visible in the DOM, then we restore it at close of the dialog.
      // Otherwise it will be removed from the DOM after close.
      if (document.contains(contentEl)) {
        restoreFn = createRestoreFn(contentEl);
      } else {
        restoreFn = function() {
          contentEl.parentNode.removeChild(contentEl);
        }
      }
    }

    return {
      element: angular.element(contentEl),
      restore: restoreFn
    };

    function createRestoreFn(element) {
      var parent = element.parentNode;
      var nextSibling = element.nextElementSibling;

      return function() {
        if (!nextSibling) {
          // When the element didn't had any sibling, then it can be simply appended to the
          // parent, because it plays no role, which index it had before.
          parent.appendChild(element);
        } else {
          // When the element had a sibling, which marks the previous position of the element
          // in the DOM, we insert it correctly before the sibling, to have the same index as
          // before.
          parent.insertBefore(element, nextSibling);
        }
      }
    }
  };

  MdCompilerService.prototype._compileElement = function(locals, element, options) {
    var self = this;
    var ngLinkFn = this.$compile(element);

    var compileData = {
      element: element,
      cleanup: element.remove.bind(element),
      locals: locals,
      link: linkFn
    };

    function linkFn(scope) {
      locals.$scope = scope;

      // Instantiate controller if the developer provided one.
      if (options.controller) {

        var injectLocals = angular.extend(locals, {
          $element: element
        });

        var invokeCtrl = self.$controller(options.controller, injectLocals, true, options.controllerAs);

        if (options.bindToController) {
          angular.extend(invokeCtrl.instance, locals);
        }

        var ctrl = invokeCtrl();

        // Unique identifier for Angular Route ngView controllers.
        element.data('$ngControllerController', ctrl);
        element.children().data('$ngControllerController', ctrl);

        // Expose the instantiated controller to the compile data
        compileData.controller = ctrl;
      }

      // Invoke the Angular $compile link function.
      return ngLinkFn(scope);
    }

    return compileData;

  };

  MdCompilerService.prototype._compileTemplate = function(options) {

    var self = this;
    var templateUrl = options.templateUrl;
    var template = options.template || '';
    var resolve = angular.extend({}, options.resolve);
    var locals = angular.extend({}, options.locals);
    var transformTemplate = options.transformTemplate || angular.identity;

    // Take resolve values and invoke them.
    // Resolves can either be a string (value: 'MyRegisteredAngularConst'),
    // or an invokable 'factory' of sorts: (value: function ValueGetter($dependency) {})
    angular.forEach(resolve, function(value, key) {
      if (angular.isString(value)) {
        resolve[key] = self.$injector.get(value);
      } else {
        resolve[key] = self.$injector.invoke(value);
      }
    });

    // Add the locals, which are just straight values to inject
    // eg locals: { three: 3 }, will inject three into the controller
    angular.extend(resolve, locals);

    if (templateUrl) {
      resolve.$$ngTemplate = this.$templateRequest(templateUrl);
    } else {
      resolve.$$ngTemplate = this.$q.when(template);
    }


    // Wait for all the resolves to finish if they are promises
    return this.$q.all(resolve).then(function(locals) {

      var template = transformTemplate(locals.$$ngTemplate, options);
      var element = options.element || angular.element('<div>').html(template.trim()).contents();

      return self._compileElement(locals, element, options);
    });

  };

  MdCompilerService.prototype._prepareContentElement = function(options) {

    var contentElement = this._fetchContentElement(options);

    return this.$q.resolve({
      element: contentElement.element,
      cleanup: contentElement.restore,
      locals: {},
      link: function() {
        return contentElement.element;
      }
    });

  };

  dockModalProvider.$inject = [
    '$mdCompiler',
    '$rootScope',
    '$q'
  ];

  function dockModalProvider($mdCompiler, $rootScope, $q) {
    var service;
    var dockModalInstances = [];
    var pendings = { };

    var defaults = {
      width: 400,
      height: "65%",
      minimizedWidth: 200,
      gutter: 10,
    }

    var show = function(options) {
      options = $.extend({}, defaults, options);

      if(!options.id) {
        console.error('Modal id is required.');
        return $q.resolve();
      }

      function resolveWhen() {
        var dfd = pendings[options.id];
        if ( dfd ) {
          dfd.forEach(function (promise) {
            promise.resolve(dockModalInstance);
          });
          delete pendings[options.id];
        }
      }

      var dockModalInstance = find(options.id);
      if(!dockModalInstance) {
        dockModalInstance = new dockModal(options);
        dockModalInstance.show().then(function() {;
          dockModalInstances.push(dockModalInstance);
          refreshLayout();
          resolveWhen();
        });
      } else {
        dockModalInstances = _.without(dockModalInstances, dockModalInstance);
        if(dockModalInstance.isMinimized()) dockModalInstance.restore();
        dockModalInstances.push(dockModalInstance);
        refreshLayout();
        resolveWhen();
      }

      return dockModalInstance.deferred.promise;
    } 

    var find = function(id) {
      return _.find(dockModalInstances, function(el) { return el.options.id === id });
    }

    var when = function(id) {
      var deferred = $q.defer();
      var instance = find(id);

      if ( instance )  {
        deferred.resolve( instance );
      } else {
        if (pendings[id] === undefined) {
          pendings[id] = [];
        }
        pendings[id].push(deferred);
      }

      return deferred.promise;
    }

    var refreshLayout = function() {
      var right = 0;
      var windowWidth = $(window).width();

      // dockModalInstances = dockModalInstances.reverse();
      _.each(dockModalInstances.slice().reverse(), function(instance, index) {
        var el = instance.options.element;
        right += instance.options.gutter;
        el.css({ "right": right + "px" });
        if (el.hasClass("minimized")) {
          right += instance.options.minimizedWidth;
        } else {
          right += instance.options.width;
        }
        if (right > windowWidth) {
          el.hide();
        } else {
          el.show();
        }
      });
    }

    var removeInstance = function(dockModalInstance) {
      dockModalInstances = _.without(dockModalInstances, dockModalInstance);
      refreshLayout();
    }

    var dockModal = function(options) {
      var self;

      var create = function() {
        return $q(function(resolve, reject) {
          self.options.transformTemplate = transformTemplate;
          self.options.scope = $rootScope.$new();
          var compiled = $mdCompiler.compile(self.options);
          compiled.then(function(compiledData) {
            var parent = angular.element('body');
            compiledData.link(self.options.scope);
            parent.append(compiledData.element);
            self.options.element = compiledData.element;
            resolve();
          });
        });
      }

      var remove = function(reason, isCancelled) {
        if(isCancelled) {
          self.deferred.reject(reason);
        } else {
          self.deferred.resolve(reason);
        }
        self.destroy();
      }

      var restore = function() {
        self.options.element.removeClass("minimized");
        self.options.element.find("dock-modal-content, dock-modal-footer").show();
        self.options.element.css({
            "width": self.options.width + "px",
            "height": self.options.height,
            "left": "auto",
            // "right": "auto",
            "top": "auto",
            "bottom": "0"
        });
        refreshLayout();
      }

      var minimize = function() {
        var headerHeight = self.options.element.find("dock-modal-header").outerHeight();
        self.options.element.addClass("minimized").css({
            "width": self.options.minimizedWidth + "px",
            "height": headerHeight + "px",
            "left": "auto",
            // "right": "auto",
            "top": "auto",
            "bottom": "0"
        });
        self.options.element.find("dock-modal-content, dock-modal-footer").hide();
        refreshLayout();
      }

      var isMinimized = function() {
        return self.options.element.hasClass('minimized');
      }

      var transformTemplate = function(template) {
        return '<div class="dockmodal" style="height:' + self.options.height + ';width: '+ self.options.width +'px">' + template + '</div>';
      }

      var destroy = function() {
        self.options.scope.$destroy();
        self.options.scope = null;
        self.options.element.remove();
        self.options.element = null;
        removeInstance(self);
      }

      return self = {
        options: options,
        deferred: $q.defer(),
        show: create,
        remove: remove,
        minimize: minimize,
        restore: restore,
        isMinimized: isMinimized,
        destroy: destroy
      }

    }

    return service = {
      show: show,
      find: find,
      when: when
    };
    
  }
})();
