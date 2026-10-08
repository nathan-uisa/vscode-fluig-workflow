/**
 * Tipagens Globais para Desenvolvimento de Scripts TOTVS Fluig
 * Fornece IntelliSense, autocompletar e documentacao para APIs de Workflow Fluig.
 */

declare namespace java.util {
  class HashMap<K = any, V = any> {
    constructor();
    put(key: K, value: V): V;
    get(key: K): V;
    containsKey(key: K): boolean;
    containsValue(value: V): boolean;
    remove(key: K): V;
    clear(): void;
    size(): number;
    isEmpty(): boolean;
  }

  class ArrayList<E = any> {
    constructor();
    add(element: E): boolean;
    get(index: number): E;
    remove(index: number): E;
    clear(): void;
    size(): number;
    isEmpty(): boolean;
  }

  class Date {
    constructor();
    constructor(date: number);
    getTime(): number;
  }
}

declare namespace java.lang {
  class System {
    static currentTimeMillis(): number;
  }
}

declare namespace com.fluig.foundation.mail.service {
  class EMailServiceBean {
    constructor();
    simpleEmail(
      companyId: number,
      subject: string,
      from: string,
      to: string,
      body: string,
      mimeType: string
    ): void;
  }
}

/**
 * Interface com a API de Processos e Formularios Fluig (hAPI).
 */
interface FluigHAPI {
  /**
   * Obtem o valor de um campo do formulario vinculado a solicitacao.
   * @param fieldName Nome do campo do formulario.
   * @returns Valor atual do campo como string.
   */
  getCardValue(fieldName: string): string;

  /**
   * Define o valor de um campo do formulario da solicitacao.
   * @param fieldName Nome do campo do formulario.
   * @param value Novo valor a ser atribuido.
   */
  setCardValue(fieldName: string, value: string | number): void;

  /**
   * Obtem o numero da thread atual da solicitacao.
   * @param processInstanceId Numero da solicitacao.
   */
  getActualThread(processInstanceId: number): number;

  /**
   * Obtem o numero da instancia do processo pai ou subprocesso avancado.
   */
  getAdvancedProcessInstanceId(): number;

  /**
   * Retorna os indices das linhas de uma tabela Pai x Filho do formulario.
   * @param tableName Nome da tabela Pai x Filho (sem os prefixos de linha).
   */
  getChildrenIndexes(tableName: string): any[];

  /**
   * Retorna os dados completos do formulario da solicitacao em formato de mapa chave/valor.
   * @param processInstanceId Numero da solicitacao.
   */
  getCardData(processInstanceId: number): java.util.HashMap<string, string>;

  /**
   * Inicia uma nova solicitacao de processo de workflow no Fluig.
   * @param processId Identificador do processo a ser iniciado.
   * @param activity Sequencia da atividade inicial para movimentacao.
   * @param colleagues Lista de usuarios destinatarios ou array de matriculas.
   * @param comments Comentario ou despacho a ser registrado.
   * @param complete Se verdadeiro, movimenta para a proxima atividade.
   * @param cardData Mapa contendo os valores para preencher o formulario.
   * @param managerMode Se verdadeiro, executa a movimentacao no modo gestor.
   * @returns Mapa contendo informacoes da solicitacao criada (ex: iProcess).
   */
  startProcess(
    processId: string,
    activity: number,
    colleagues: any,
    comments: string,
    complete: boolean,
    cardData: any,
    managerMode: boolean
  ): java.util.HashMap<any, any>;

  /**
   * Calcula o prazo de conclusao de uma atividade considerando o expediente de trabalho cadastrado.
   * @param date Data base de inicio do calculo.
   * @param seconds Quantidade de segundos a serem adicionados.
   * @param periodId Identificador do expediente/periodo de atendimento (opcional).
   */
  calculateDeadline(date: any, seconds: number, periodId?: string): any;

  /**
   * Define a decisao automatica para uma atividade de fluxo.
   * @param sequence Sequencia da atividade de destino.
   * @param colleagues Destinatarios para atribuicao.
   * @param comments Comentario a ser gravado no historico.
   */
  setAutomaticDecision(sequence: number, colleagues: any, comments: string): void;

  /**
   * Adiciona um despacho ou observacao ao historico da solicitacao.
   * @param userId Matricula do usuario autor do comentario.
   * @param processInstanceId Numero da solicitacao.
   * @param threadSequence Sequencia da thread (geralmente 0).
   * @param comments Texto do comentario a ser anexado.
   */
  setTaskComments(
    userId: string,
    processInstanceId: number,
    threadSequence: number,
    comments: string
  ): void;

  /**
   * Retorna a sequencia da atividade na qual o usuario atual se encontra.
   * @param processInstanceId Numero da solicitacao.
   */
  getUserTask(processInstanceId: number): number;

  /**
   * Retorna os dados cadastrais do usuario/colega informado.
   * @param colleagueId Matricula do usuario no Fluig.
   */
  getColleague(colleagueId: string): any;
}

/**
 * Tipos de condicao aplicaveis a uma Constraint de consulta a Datasets Fluig.
 */
declare enum ConstraintType {
  /** Clausula obrigatoria (operador logico AND). */
  MUST = 1,
  /** Clausula opcional (operador logico OR). */
  SHOULD = 2,
  /** Clausula de exclusao (operador logico NOT). */
  MUST_NOT = 3
}

/**
 * Estrutura de filtro para selecao em Datasets Fluig.
 */
interface Constraint {
  getFieldName(): string;
  getInitialValue(): any;
  getFinalValue(): any;
  getConstraintType(): ConstraintType;
  isLikeSearch(): boolean;
}

/**
 * Representacao de um Dataset de dados no Fluig.
 */
interface Dataset {
  /** Quantidade total de linhas contidas no dataset. */
  rowsCount: number;

  /** Array com o nome das colunas do dataset. */
  columnsName: string[];

  /** Matriz bidimensional contendo as linhas e colunas de dados. */
  values: any[][];

  /**
   * Obtem o valor de uma determinada coluna na linha especificada.
   * @param row Indice da linha (iniciando em 0).
   * @param column Nome da coluna desejada.
   */
  getValue(row: number, column: string): any;

  /**
   * Adiciona uma nova linha ao dataset (utilizado em definicoes de Datasets Customizados).
   * @param rowValues Array com os valores correspondentes a cada coluna.
   */
  addRow(rowValues: any[]): void;

  /**
   * Cria uma nova coluna no dataset.
   * @param columnName Identificador da nova coluna.
   */
  addColumn(columnName: string): void;
}

/**
 * Fabrica para consulta e criacao de Datasets no Fluig.
 */
interface DatasetFactoryStatic {
  /**
   * Consulta e retorna um dataset interno ou customizado do Fluig.
   * @param datasetId Identificador do dataset (ex: 'colleague', 'ds_meu_dataset').
   * @param fields Lista de campos a serem retornados, ou null para todos.
   * @param constraints Lista de filtros Constraint criados via createConstraint, ou null.
   * @param orders Lista de campos para ordenacao, ou null.
   */
  getDataset(
    datasetId: string,
    fields: string[] | null,
    constraints: Constraint[] | null,
    orders: string[] | null
  ): Dataset;

  /**
   * Cria uma nova condicao de busca (constraint) para ser utilizada no getDataset.
   * @param field Nome do campo / coluna a ser filtrada.
   * @param initialValue Valor inicial ou termo exato da busca.
   * @param finalValue Valor final da faixa, ou igual a initialValue.
   * @param type Tipo da condicao (ConstraintType.MUST, SHOULD ou MUST_NOT).
   * @param like Se verdadeiro, realiza busca com correspondencia parcial (LIKE).
   */
  createConstraint(
    field: string,
    initialValue: any,
    finalValue: any,
    type: ConstraintType,
    like?: boolean
  ): Constraint;
}

/**
 * Servico de geracao de logs no servidor de aplicacao Fluig.
 */
interface FluigLog {
  /**
   * Grava mensagem informativa no arquivo de log do servidor (server.log).
   * @param message Mensagem ou objeto a ser registrado.
   */
  info(message: any): void;

  /**
   * Grava mensagem de alerta no log do servidor.
   * @param message Mensagem ou objeto de alerta.
   */
  warn(message: any): void;

  /**
   * Grava mensagem de erro no log do servidor.
   * @param message Mensagem de erro ou stack trace.
   */
  error(message: any): void;

  /**
   * Grava mensagem de depuracao no log do servidor.
   * @param message Mensagem de depuracao.
   */
  debug(message: any): void;
}

/**
 * Servico para envio de notificacoes do Fluig.
 */
interface FluigNotifier {
  /**
   * Envia uma notificacao por e-mail ou central de notificacoes Fluig.
   * @param sender Matricula do usuario remetente (ex: 'admin').
   * @param template Codigo do template de e-mail cadastrado no Fluig.
   * @param params Mapa com os parametros de substituicao do template.
   * @param receivers Lista ou destinatario da mensagem.
   * @param media Canal de transmissao (ex: 'mail').
   */
  notify(sender: string, template: string, params: any, receivers: any, media?: string): void;
}

/**
 * Objeto hAPI global disponivel em todos os scripts de eventos de processos Fluig.
 */
declare const hAPI: FluigHAPI;

/**
 * Fabrica de datasets global do Fluig.
 */
declare const DatasetFactory: DatasetFactoryStatic;

/**
 * Enumerador de tipos de constraints do Fluig.
 */
declare const ConstraintType: {
  MUST: ConstraintType;
  SHOULD: ConstraintType;
  MUST_NOT: ConstraintType;
};

/**
 * Gravador de logs no servidor Fluig.
 */
declare const log: FluigLog;

/**
 * Gerenciador de notificacoes do Fluig.
 */
declare const notifier: FluigNotifier;

/**
 * Obtem propriedades globais e variaveis de contexto do processo em execucao.
 */
declare function getValue(property: "WKDef"): string;
declare function getValue(property: "WKVersDef"): number;
declare function getValue(property: "WKNumProces"): number;
declare function getValue(property: "WKNumState"): number;
declare function getValue(property: "WKNextState"): number;
declare function getValue(property: "WKCurrentState"): number;
declare function getValue(property: "WKUser"): string;
declare function getValue(property: "WKCompany"): number;
declare function getValue(property: "WKManagerMode"): boolean;
declare function getValue(property: "WKCardId"): number;
declare function getValue(property: "WKFormMode"): "VIEW" | "MOD" | "ADD";
declare function getValue(property: "WKMobile"): boolean;
declare function getValue(property: string): any;
