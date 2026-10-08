function servicetask10(attempt, message) {
    log.info("=================servicetask10 - Cartão Alerta SSBET ============");

    var campoDecisao = hAPI.getCardValue("desvio");
    log.info("valor de campoDecisao: " + campoDecisao);

    /* condição abaixo verifica com base no campo "desvio"  do item 6 se será necessário gerar plano de ação*/

    if (campoDecisao == "não") {
        log.info("condição verdadeira servicetask10");

        // //Campos do Cartão Alerta
        var processID = hAPI.getCardValue("processID");
        var TPLANO = hAPI.getCardValue("tipoPlano");
        var EMP = hAPI.getCardValue("empresaEmitente");
        var SECAO = hAPI.getCardValue("secaoOcorrencia");
        var DTOCORR = hAPI.getCardValue("dataEmissao");
        var idGestorArea = hAPI.getCardValue("gerenciaOcorrencia");
        var gestorArea = hAPI.getCardValue("MatriculaResparea") + " - " + hAPI.getCardValue("gerenciaOcorrencia");
        var Responsavel = hAPI.getCardValue("matriculaLider"); //groupPK.groupId - idGestorArea

        var campoCheckbox1 = hAPI.getCardValue("TipoComunicacao_1");
        var campoCheckbox3 = hAPI.getCardValue("TipoComunicacao_3");
        var campoCheckbox4 = hAPI.getCardValue("TipoComunicacao_4");
        var campoCheckbox5 = hAPI.getCardValue("TipoComunicacao_5");
        var campoCheckbox6 = hAPI.getCardValue("TipoComunicacao_6");
        var ResponsavelDesvio = hAPI.getCardValue("Resparea");

        // var IDENTIFICADO = hAPI.getCardValue("identificado");
        var ACAO = hAPI.getCardValue("acaoTomada");
        var ACAO2 = hAPI.getCardValue("acaoNecessaria");
        var SUGESTAO = hAPI.getCardValue("acaoNecessaria");
        var DESVIO = hAPI.getCardValue("desvio");
        var SOLICITACAO = hAPI.getCardValue("WKNumProcess");

        var titulo = TPLANO + " - " + DTOCORR + " - " + EMP;
        var processo = "Plano_Ação_SSBET";
        var numAtividade = 0;
        var comentario = 'Solicitação iniciada através do Cartão Alerta ' + processID;

        var users = new java.util.ArrayList();
        users.clear();
        users.add(Responsavel);


        var formData = new java.util.HashMap();
        //formData.put("WKUser", idGestorArea);
        formData.put("tipoPlano", TPLANO);
        formData.put("empresa", EMP);
        formData.put("area", SECAO);
        formData.put("dtOcorrencia", DTOCORR);
        formData.put("idGestorArea", idGestorArea);
        formData.put("gestorArea", gestorArea);
        formData.put("AutomaticCreate", "1");
        formData.put("Resp", idGestorArea);
        formData.put("Solicitacao_vinculada", processID);
        formData.put("respPlanoAcao", gestorArea);
        // formData.put("Cartao_Alerta", processID);
        formData.put("tituloPlano", titulo);

        // formData.put("identificado", IDENTIFICADO);
        formData.put("acao", ACAO);
        formData.put("sugestao", SUGESTAO);
        formData.put("desvio", DESVIO);

        formData.put("option1", campoCheckbox6);
        formData.put("option2", campoCheckbox1);
        formData.put("option3", campoCheckbox3);
        formData.put("option4", campoCheckbox4);
        formData.put("option5", campoCheckbox5);

        formData.put("respAcaoTB___1", ResponsavelDesvio);
        formData.put("dtAcaoTB___1", DTOCORR);
        formData.put("idFluigAcaoTB___1", ACAO);
        formData.put("descAcaoTB___1", ACAO2);

        formData.put("tituloPlano", titulo);


        /* function getChildrenIndex() {
    
            var numProcess = getValue("WKNumProces");
            var cardData = hAPI.getCardData(numProcess);
            var iterator = cardData.keySet().iterator();
        
            if (tablename === 'dadosenvolvidos') {
                var itemsIndexes = [];
        
                while (iterator.hasNext()) {
                    var key = iterator.next();
        
                    if (key.match(/saldo___/)) {
                        itemsIndexes.push(key.split("___")[1]);
                    }
                }
                return itemsIndexes;
            }
        } */

        // hAPI.startProcess(processo, 0, users, comentario, true, formData, false);
    }
}


