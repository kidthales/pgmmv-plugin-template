// noinspection ES6ConvertVarToLetConst
/// <reference path="./node_modules/@kidthales/pgmmv-types/pgmmv.d.ts" />
(function () {
  // noinspection UnnecessaryLocalVariableJS
  /**
   * @type {import("@kidthales/pgmmv-types").AgtkPlugin}
   */
  var plugin = {
      /**
       * @param {string} locale
       */
      setLocale: function (locale) {},

      /**
       * @param {import("@kidthales/pgmmv-types").AgtkPluginInfoCategoryValue} category
       */
      getInfo: function (category) {
        switch (category) {
          case 'name':
            return 'PGMMV Plugin Template';
          case 'description':
            return 'PGMMV Plugin Template';
          case 'author':
            return 'Author Name';
          case 'help':
            return 'Plugin Help';
          case 'parameter':
            return [];
          case 'internal':
            return {};
          case 'actionCommand':
            return [];
          case 'linkCondition':
            return [];
          default:
            break;
        }
      },

      /**
       * @param {import("@kidthales/pgmmv-types").AgtkPluginInfoResult<'internal'>} [data]
       */
      initialize: function (data) {
        if (isEditor()) {
          return;
        }

        Agtk.log('Initialize ' + plugin.getInfo('name'));
      },

      finalize: function () {},

      /**
       * @param {import("@kidthales/pgmmv-types").AgtkParameterValue[]} paramValue
       */
      setParamValue: function (paramValue) {
        if (isEditor()) {
          return;
        }

        for (var i = 0; i < paramValue.length; ++i) {
          Agtk.log('Parameter ' + paramValue[i].id + ' = ' + paramValue[i].value);
        }
      },

      /**
       * @param {import("@kidthales/pgmmv-types").AgtkPluginInfoResult<'internal'>} data
       */
      setInternal: function (data) {},

      call: function () {},

      /**
       * @param {number} delta
       */
      update: function (delta) {},

      /**
       * @param {number} actionCommandIndex
       * @param {import("@kidthales/pgmmv-types").AgtkParameterValue[]} parameter
       * @param {number} objectId
       * @param {number} instanceId
       * @param {number} actionId
       * @param {number} commandId
       * @param {0 | 1} commonActionStatus
       * @param {number} sceneId
       */
      execActionCommand: function (
        actionCommandIndex,
        parameter,
        objectId,
        instanceId,
        actionId,
        commandId,
        commonActionStatus,
        sceneId
      ) {},

      /**
       * @param {number} linkConditionIndex
       * @param {import("@kidthales/pgmmv-types").AgtkParameterValue[]} parameter
       * @param {number} objectId
       * @param {number} instanceId
       * @param {number} actionLinkId
       * @param {-1 | 0 | 1} commonActionStatus
       * @returns {boolean}
       */
      execLinkCondition: function (
        linkConditionIndex,
        parameter,
        objectId,
        instanceId,
        actionLinkId,
        commonActionStatus
      ) {
        return false;
      }
    },
    /**
     * @returns {boolean}
     */
    isEditor = function () {
      return !Agtk || typeof Agtk.log !== 'function';
    };

  return plugin;
})();
