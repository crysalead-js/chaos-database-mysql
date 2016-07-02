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
      booleans: true,
      default: false
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
      client: undefined,
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
    this._client = config.client;

    /**
     * Whether the client is connected or not.
     *
     * @var Boolean
     */
    this._connected = false;

    /**
     * The SQL dialect instance.
     *
     * @var Function
     */
    var dialect = this.classes().dialect;

    if (typeof this._dialect !== 'object') {
      this._dialect = new dialect({
        caster: function(value, states) {
          var type = states && states.type ? states.type : this.constructor.getType(value);
          if (typeof type === 'function') {
            type = type(states.name);
          }
          return this.convert('datasource', type, value);
        }.bind(this)
      });
    }
  }

  /**
   * Returns the client instance.
   *
   * @return Function
   */
  client() {
    return this._client;
  }

  /**
   * Connects to the database using the options provided to the class constructor.
   *
   * @return boolean Returns `true` if a database connection could be established,
   *                 otherwise `false`.
   */
  connect() {
    if (this._client) {
      return Promise.resolve(this._client);
    }

    var config = this.config();

    if (!config.database) {
      return Promise.reject(new Error('Error, no database name has been configured.'));
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var client = mysql.createConnection(config);
      self._client = client;
      client.connect(function(err) {
        if (err) {
          return reject(new Error('Unable to connect to host , error ' + err.code + ' ' + err.stack));
        }
        self._connected = true;
        accept(client)
      });
    });
  }

  /**
   * Checks the connection status of this data source.
   *
   * @return Boolean Returns a boolean indicating whether or not the connection is currently active.
   *                 This value may not always be accurate, as the connection could have timed out or
   *                 otherwise been dropped by the remote resource during the course of the request.
   */
  connected() {
    return this._connected;
  }

  /**
   * Finds records using a SQL query.
   *
   * @param  string sql  SQL query to execute.
   * @param  array  data Array of bound parameters to use as values for query.
   *                     WARNING data must be clean at this step. SQL injection must be handled earlier.
   * @return object      A `Cursor` instance.
   */
  query(sql, data, options) {
    var self = this;
    return new Promise(function(accept, reject) {
      var defaults = {};
      options = extend({}, defaults, options);

      var cursor = self.constructor.classes().cursor;

      self.connect().then(function() {
        self._client.query(sql, function(err, data) {
          if (err) {
            return reject(err);
          }
          if (data && data.insertId !== undefined) {
            self._lastInsertId = data.insertId;
            accept(true);
          } else {
            accept(data ? new cursor({ data: data }) : true);
          }
        });
      });
    });
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
        var field = this._field(column);
        var dflt = column.Default;

        switch (field.type) {
          case 'boolean':
            dflt = dflt === '1';
            break;
          case 'datetime':
            dflt = dflt !== 'CURRENT_TIMESTAMP' ? dflt : null;
            break;
        }

        tmp = {};
        tmp[column.Field] = extend({}, {
          null: (column.Null === 'YES' ? true : false),
          'default': dflt
        }, field);

        fields.push(tmp);
      }
      return fields;
    }.bind(this));
  }

  /**
   * Converts database-layer column to a generic field.
   *
   * @param  Object column Database-layer column.
   * @return Object        A generic field.
   */
  _field(column) {
    var matches = column.Type.match(/(\w+)(?:\(([\d,]+)\))?/);
    var field = {};
    field.type = matches[1];
    field.length = matches[2];
    field.use = field.type;

    if (field.length) {
      var length = field.length.split(',');
      field.length = Number.parseInt(length[0]);
      if (length[1]) {
        field.precision = Number.parseInt(length[1]);
      }
    }

    field.type = this.dialect().mapped(field);
    return field;
  }

  /**
   * Disconnects the adapter from the database.
   *
   * @return Boolean Returns `true` on success, else `false`.
   */
  disconnect() {
    if (!this._client) {
      return true;
    }
    this._client.end();
    this._client = undefined;
    this._connected = false;
    return true;
  }
}

export default MySql;
