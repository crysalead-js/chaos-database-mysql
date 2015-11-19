import co from 'co';
import mysql from 'mysql';
import { extend, merge } from 'extend-merge';
import { Database } from 'chaos-database';
import { MySql as MySqlDialect } from 'sql-dialect';

/**
 * MySQL adapter
 */
class MySql extends Database {
  /**
   * Check for required PHP extension, or supported database feature.
   *
   * @param  String  feature Test for support for a specific feature, i.e. `"transactions"`
   *                         or `"arrays"`.
   * @return Boolean         Returns `true` if the particular feature is supported, `false` otherwise.
   */
  static enabled(feature) {
    var features = {
      arrays: false,
      transactions: true,
      booleans: true
    };
    if (!arguments.length) {
      return extend({}, features);
    }
    return features[feature];
  }

  /**
   * Constructs the MySQL adapter and sets the default port to 3306.
   *
   * @param Object config Configuration options for this class. Available options
   *                      defined by this class:
   *                      - `'host'`: _string_ The IP or machine name where MySQL is running,
   *                                  followed by a colon, followed by a port number or socket.
   *                                  Defaults to `'localhost'`.
   */
  constructor(config) {
    var defaults = {
      classes: {
        dialect: MySqlDialect
      },
      connectionLimit: 10,
      host: 'localhost',
      alias: true,
      driver: undefined,
      dialect: true
    };
    config = merge({}, defaults, config);
    super(config);

    /**
     * Aliases username to user.
     */
    this._config.user = config.username ? config.username : this._config.username;

    /**
     * Specific value denoting whether or not table aliases should be used in DELETE and UPDATE queries.
     *
     * @var Boolean
     */
    this._alias = config.alias;

    /**
     * Stores a connection to a remote resource.
     *
     * @var Function
     */
    this._driver = config.driver;

    /**
     * The SQL dialect instance.
     *
     * @var Function
     */
    var dialect = this.classes().dialect;

    if (typeof this._dialect !== 'object') {
      this._dialect = new dialect({
        quoter: function(string) {
          return this._driver.escape(string);
        }.bind(this),
        caster: function(value, states) {
          var type = states && states.type ? states.type : this.constructor.getType(value);
          if (typeof type === 'function') {
            type = type(states.name);
          }
          return this.format('datasource', type, value);
        }.bind(this)
      });
    }
  }

  /**
   * Returns the pdo connection instance.
   *
   * @return Function
   */
  driver() {
    return this.connect();
  }

  /**
   * Connects to the database using the options provided to the class constructor.
   *
   * @return boolean Returns `true` if a database connection could be established,
   *                 otherwise `false`.
   */
  connect() {
    if (this._driver) {
      return Promise.resolve(this._driver);
    }

    var config = this.config();

    if (!config.database) {
      return Promise.reject(new Error('Error, no database name has been configured.'));
    }

    return new Promise(function(accept, reject) {
      var driver = mysql.createConnection(config);
      this._driver = driver;
      driver.connect(function(err) {
        if (err) {
          reject(new Error('Unable to connect to host , error ' + err.code + ' ' + err.stack));
        }
        accept(driver)
      });
    }.bind(this));
  }

  /**
   * Checks the connection status of this data source.
   *
   * @return Boolean Returns a boolean indicating whether or not the connection is currently active.
   *                 This value may not always be accurate, as the connection could have timed out or
   *                 otherwise been dropped by the remote resource during the course of the request.
   */
  connected() {
    return !!this._driver;
  }

  /**
   * Finds records using a SQL query.
   *
   * @param  string sql  SQL query to execute.
   * @param  array  data Array of bound parameters to use as values for query.
   * @return object       A `Cursor` instance.
   */
  query(sql, data, options) {
    return new Promise(function(accept, reject) {
      var defaults = {};
      options = extend({}, defaults, options);

      var cursor = this.constructor.classes().cursor;

      this.driver().then(function() {
        this._driver.query(sql, function(err, data) {
          if (err) {
            reject(err);
          }
          if (data) {
            this._lastInsertId = data.insertId;
            data = new cursor({ data: data });
          }
          accept(data);
        }.bind(this));
      }.bind(this))
    }.bind(this));
  }

  /**
   * Returns the last insert id from the database.
   *
   * @return mixed Returns the last insert id.
   */
  lastInsertId() {
    return this._lastInsertId;
  }

  /**
   * Returns the list of tables in the currently-connected database.
   *
   * @return Object Returns an object of sources to which models can connect.
   */
  sources() {
    var select = this.dialect().statement('select');
    select.fields('table_name')
      .from({ information_schema: ['tables'] })
      .where([
         { table_type: 'BASE TABLE' },
         { table_schema: this._config.database }
      ]);
    return this._sources(select);
  }

  /**
   * Gets the column schema for a given MySQL table.
   *
   * @param  mixed    name   Specifies the table name for which the schema should be returned.
   * @param  Object   fields Any schema data pre-defined by the model.
   * @param  Object   meta
   * @return Function        Returns a shema definition.
   */
  describe(name, fields, meta) {
    var nbargs = arguments.length;
    return co(function*() {
      if (nbargs === 1) {
        fields = yield this.fields(name);
      }

      var schema = this.classes().schema;

      return new schema({
        connection: this,
        source: name,
        fields: fields,
        meta: meta
      });
    }.bind(this));
  }

  /**
   * Extracts fields definitions of a table.
   *
   * @param  String name The table name.
   * @return Object      The fields definitions.
   */
  fields(name) {
    return co(function*() {
      var tmp, fields = [];
      var columns = yield this.query('DESCRIBE ' + name);
      for (var column of columns) {
        var field = this._column(column.Type);
        var dft = column.Default;

        switch (field.type) {
          case 'boolean':
            if (dft === '1') {
              dft = true;
            }
            if (dft === '0') {
              dft = false;
            }
            break;
          case 'datetime':
            dft = dft !== 'CURRENT_TIMESTAMP' ? dft : null;
            break;
        }

        tmp = {};
        tmp[column.Field] = extend({}, {
          null: (column.Null === 'YES' ? true : false),
          'default': dft
        }, field);

        fields.push(tmp);
      }
      return fields;
    }.bind(this));
  }

  /**
   * Converts database-layer column types to basic types.
   *
   * @param  string real Real database-layer column type (i.e. `"varchar(255)"`)
   * @return array        Column type (i.e. "string") plus 'length' when appropriate.
   */
  _column(real) {
    var matches = real.match(/(\w+)(?:\(([\d,]+)\))?/);
    var column = {};
    column.type = matches[1];
    column.length = matches[2];
    column.use = column.type;

    if (column.length) {
      var length = column.length.split(',');
      column.length = Number.parseInt(length[0]);
      if (length[1]) {
        column.precision = Number.parseInt(length[1]);
      }
    }

    column.type = this.dialect().mapped(column);
    return column;
  }

  /**
   * Disconnects the adapter from the database.
   *
   * @return Boolean Returns `true` on success, else `false`.
   */
  disconnect() {
    if (!this._driver) {
      return true;
    }
    this._driver.end();
    this._driver = undefined;
    return true;
  }
}

export default MySql;
